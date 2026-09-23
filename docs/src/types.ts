export interface ToolDownloads {
  windows?: string;
  linux?: string;
  chrome?: string;
  firefox?: string;
  mac?: string;
  [key: string]: string | undefined;
}

export interface ToolManifest {
  name: string;
  description: string;
  github: string;
  icon?: string;
  images?: string[];
  detail?: string;
  downloads?: ToolDownloads;
}

export interface ToolItem {
  id: string;
  manifest: ToolManifest;
  basePath: string;
}

export interface GitHubAsset {
  id: number;
  name: string;
  size: number;
  browser_download_url: string;
}

export interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  html_url: string;
  assets: GitHubAsset[];
}

export type PlatformKey = "windows" | "linux" | "chrome" | "firefox" | "mac";

export type UserOS = "windows" | "linux" | "mac" | "other";
export type UserBrowser = "firefox" | "chrome" | "safari" | "other";

export interface UserEnvironment {
  os: UserOS;
  browser: UserBrowser;
  osLabel: string;
  browserLabel: string;
  summaryLabel: string;
}

export interface GitHubRateLimitInfo {
  limit: number;
  remaining: number;
  resetTimestamp: number;
  resetTimeString: string;
  minutesUntilReset: number;
}

export interface GitHubApiError {
  type: "rate_limit" | "not_found" | "http_error" | "network_error";
  status?: number;
  message: string;
  rateLimit?: GitHubRateLimitInfo;
}

export interface FetchReleaseResult {
  release: GitHubRelease | null;
  error?: GitHubApiError;
}

export interface DownloadOption {
  platform: PlatformKey;
  label: string;
  iconClass: string;
  filename: string;
  sizeText?: string;
  statusReason?: string;
  url: string;
  isRecommended?: boolean;
}

