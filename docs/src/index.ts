import { TOOL_IDS, DEFAULT_PLACEHOLDER_ICON, PLATFORM_CONFIG } from "./config";
import { fetchLatestRelease } from "./api/github";
import { getUserEnvironment, resolveMatchingPlatform } from "./utils/platform";
import type { ToolManifest, ToolItem, PlatformKey, UserEnvironment } from "./types";

async function loadTools(): Promise<ToolItem[]> {
  const results = await Promise.all(
    TOOL_IDS.map(async (id) => {
      try {
        const basePath = `tools/${id}`;
        const response = await fetch(`${basePath}/tool.json`);
        if (!response.ok) {
          throw new Error(`Failed to load ${id}`);
        }
        const manifest: ToolManifest = await response.json();
        return { id, manifest, basePath };
      } catch (err) {
        console.warn(`ツール情報ロード失敗: ${id}`, err);
        return null;
      }
    })
  );

  return results.filter((item): item is ToolItem => item !== null);
}

/**
 * ツールマニフェストとユーザー利用環境から最適な初期ダウンロードURLを算出します。
 * 非対応の場合は null を返し、ダウンロードボタンを出さないようにします。
 */
function resolveInitialDownload(
  manifest: ToolManifest,
  env: UserEnvironment
): { url: string; filename: string; platform: PlatformKey } | null {
  const match = resolveMatchingPlatform(manifest.downloads, env);
  if (!match) return null;

  if (match.filename.startsWith("branch:")) {
    const branch = match.filename.replace("branch:", "");
    return {
      url: `https://github.com/${manifest.github}/archive/refs/heads/${branch}.zip`,
      filename: `${branch}.zip`,
      platform: match.platform,
    };
  }

  return {
    url: `https://github.com/${manifest.github}/releases/latest/download/${match.filename}`,
    filename: match.filename,
    platform: match.platform,
  };
}

function createToolCard(tool: ToolItem, env: UserEnvironment): HTMLElement {
  const { id, manifest, basePath } = tool;
  const card = document.createElement("article");
  card.className = "tool-card";

  const iconSrc = manifest.icon ? `${basePath}/${manifest.icon}` : DEFAULT_PLACEHOLDER_ICON;
  const detailUrl = `tool.html?tool=${encodeURIComponent(id)}`;
  const initialDownload = resolveInitialDownload(manifest, env);

  // 対応プラットフォームのアイコン生成
  const downloads = manifest.downloads || {};
  const platformsHtml = Object.keys(downloads)
    .filter((key): key is PlatformKey => key in PLATFORM_CONFIG)
    .map((key) => {
      const config = PLATFORM_CONFIG[key];
      return `<span class="platform-icon" title="${escapeHtml(config.label)}" aria-label="${escapeHtml(config.label)}"><i class="${config.iconClass}"></i></span>`;
    })
    .join("");

  // 非対応の場合はダウンロードボタンを出さない
  const downloadBtnHtml = initialDownload
    ? `<a class="button primary" data-download-btn="${id}" data-platform="${initialDownload.platform}" href="${initialDownload.url}" download="${escapeHtml(initialDownload.filename)}">
         <i class="fa-solid fa-download"></i> ダウンロード
       </a>`
    : "";

  card.innerHTML = `
    <a href="${detailUrl}" tabindex="-1" aria-hidden="true">
      <img class="tool-card-icon" src="${iconSrc}" alt="" loading="lazy" onerror="this.src='${DEFAULT_PLACEHOLDER_ICON}'">
    </a>
    <div class="tool-card-body">
      <a class="tool-card-summary-link" href="${detailUrl}">
        <div class="tool-card-top">
          <h2 class="tool-card-title">${escapeHtml(manifest.name)}</h2>
          <div class="tool-card-platforms" aria-label="対応プラットフォーム">
            ${platformsHtml}
          </div>
        </div>
        <p class="tool-card-description">${escapeHtml(manifest.description)}</p>
      </a>
      <div class="tool-card-actions">
        ${downloadBtnHtml}
        <a class="button secondary" href="${detailUrl}">
          <i class="fa-solid fa-arrow-right"></i> 詳細を見る
        </a>
      </div>
    </div>
  `;

  return card;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function updateReleasesAndDownloads(tools: ToolItem[]): Promise<void> {
  await Promise.all(
    tools.map(async (tool) => {
      const btn = document.querySelector<HTMLAnchorElement>(`[data-download-btn="${tool.id}"]`);
      if (!btn) return;

      const targetPlatform = btn.getAttribute("data-platform");
      if (!targetPlatform) return;

      const result = await fetchLatestRelease(tool.manifest.github);
      const release = result.release;
      if (!release) return;

      const targetFilename = tool.manifest.downloads?.[targetPlatform];
      if (targetFilename && !targetFilename.startsWith("branch:")) {
        const asset = release.assets.find((a) => a.name === targetFilename);
        if (asset) {
          btn.href = asset.browser_download_url;
          btn.setAttribute("download", asset.name);
        }
      }
    })
  );
}

async function init(): Promise<void> {
  const statusEl = document.getElementById("status");
  const gridEl = document.getElementById("tool-grid");

  if (!gridEl) return;

  try {
    const env = getUserEnvironment();
    const tools = await loadTools();
    if (tools.length === 0) {
      if (statusEl) {
        statusEl.className = "status error";
        statusEl.textContent = "配布可能なツールが見つかりませんでした。";
      }
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const tool of tools) {
      fragment.appendChild(createToolCard(tool, env));
    }

    gridEl.appendChild(fragment);
    if (statusEl) {
      statusEl.remove();
    }

    // 非同期でバージョン情報と最新ダウンロードURLを更新
    updateReleasesAndDownloads(tools);
  } catch (error) {
    console.error("ツール一覧の初期化に失敗しました:", error);
    if (statusEl) {
      statusEl.className = "status error";
      statusEl.textContent = "ツールの読み込み中にエラーが発生しました。時間を置いて再度お試しください。";
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

