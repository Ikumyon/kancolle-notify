import type { GitHubRelease, FetchReleaseResult, GitHubRateLimitInfo } from "../types";

const RELEASE_CACHE_KEY_PREFIX = "ik_release_cache_";
const RATE_LIMIT_KEY = "ik_github_ratelimit";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10分間キャッシュ

interface CachedRelease {
  data: GitHubRelease;
  timestamp: number;
}

/**
 * GitHub APIレスポンスヘッダーからレートリミット情報を抽出します。
 */
export function parseRateLimit(headers: Headers): GitHubRateLimitInfo | undefined {
  const limitStr = headers.get("x-ratelimit-limit");
  const remainingStr = headers.get("x-ratelimit-remaining");
  const resetStr = headers.get("x-ratelimit-reset");

  if (!resetStr) return undefined;

  const resetTimestamp = parseInt(resetStr, 10) * 1000;
  if (isNaN(resetTimestamp)) return undefined;

  const now = Date.now();
  const diffMs = Math.max(0, resetTimestamp - now);
  const minutesUntilReset = Math.ceil(diffMs / (60 * 1000));
  const resetDate = new Date(resetTimestamp);
  const resetTimeString = resetDate.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return {
    limit: limitStr ? parseInt(limitStr, 10) : 60,
    remaining: remainingStr ? parseInt(remainingStr, 10) : 0,
    resetTimestamp,
    resetTimeString,
    minutesUntilReset,
  };
}

/**
 * 保存されているレートリミット情報（有効期間内のもの）を取得します。
 */
export function getStoredRateLimit(): GitHubRateLimitInfo | null {
  try {
    const raw = sessionStorage.getItem(RATE_LIMIT_KEY);
    if (!raw) return null;
    const info: GitHubRateLimitInfo = JSON.parse(raw);
    if (Date.now() < info.resetTimestamp) {
      // 残り分数を最新の時刻で再計算
      const diffMs = Math.max(0, info.resetTimestamp - Date.now());
      info.minutesUntilReset = Math.ceil(diffMs / (60 * 1000));
      return info;
    }
    sessionStorage.removeItem(RATE_LIMIT_KEY);
  } catch {
    // ignore
  }
  return null;
}

/**
 * レートリミット情報をセッションに保存します。
 */
function storeRateLimit(info: GitHubRateLimitInfo): void {
  try {
    sessionStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(info));
  } catch {
    // ignore
  }
}

/**
 * 指定されたリポジトリの最新Release情報を取得します。
 * レートリミット発生時は理由とリセット時刻を返します。
 */
export async function fetchLatestRelease(repo: string): Promise<FetchReleaseResult> {
  const cacheKey = `${RELEASE_CACHE_KEY_PREFIX}${repo}`;

  // 1. キャッシュされたリリース情報があれば返す
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const parsed: CachedRelease = JSON.parse(cached);
      if (Date.now() - parsed.timestamp < CACHE_TTL_MS) {
        return { release: parsed.data };
      }
    }
  } catch {
    // ignore
  }

  // 2. 既にレート制限にかかっている場合はリクエストを節約して制限エラーを返す
  const activeRateLimit = getStoredRateLimit();
  if (activeRateLimit && activeRateLimit.remaining === 0) {
    return {
      release: null,
      error: {
        type: "rate_limit",
        status: 403,
        message: `GitHub APIのレート制限中です（${activeRateLimit.resetTimeString} にリセット予定 / 残り約${activeRateLimit.minutesUntilReset}分）。`,
        rateLimit: activeRateLimit,
      },
    };
  }

  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github.v3+json",
      },
    });

    const rateLimit = parseRateLimit(response.headers);
    if (rateLimit) {
      if (rateLimit.remaining === 0) {
        storeRateLimit(rateLimit);
      }
    }

    if (response.status === 403) {
      const info = rateLimit || getStoredRateLimit() || {
        limit: 60,
        remaining: 0,
        resetTimestamp: Date.now() + 60 * 60 * 1000,
        resetTimeString: "1時間後",
        minutesUntilReset: 60,
      };
      storeRateLimit(info);

      return {
        release: null,
        error: {
          type: "rate_limit",
          status: 403,
          message: `GitHub APIレート制限（60回/時）に達しました。${info.resetTimeString} に解除されます。`,
          rateLimit: info,
        },
      };
    }

    if (response.status === 404) {
      return {
        release: null,
        error: {
          type: "not_found",
          status: 404,
          message: "最新リリース情報が登録されていません。",
          rateLimit,
        },
      };
    }

    if (!response.ok) {
      return {
        release: null,
        error: {
          type: "http_error",
          status: response.status,
          message: `GitHub APIエラー (${response.status}: ${response.statusText})`,
          rateLimit,
        },
      };
    }

    const data: GitHubRelease = await response.json();

    try {
      const cachePayload: CachedRelease = {
        data,
        timestamp: Date.now(),
      };
      sessionStorage.setItem(cacheKey, JSON.stringify(cachePayload));
    } catch {
      // ignore
    }

    return { release: data };
  } catch (error) {
    console.warn(`GitHub Release取得失敗 (${repo}):`, error);
    return {
      release: null,
      error: {
        type: "network_error",
        message: "ネットワークエラーにより最新情報を取得できませんでした。",
      },
    };
  }
}

