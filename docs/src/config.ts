import type { PlatformKey } from "./types";

export const TOOL_IDS: readonly string[] = [
  "kancolle-notify",
  "kancolle-stream-overlay",
  "kco-relay",
  "kco-senka-reader",
  "kco-title-fetcher",
] as const;

export const DEFAULT_PLACEHOLDER_ICON = "assets/tool-placeholder.svg";

export interface PlatformMeta {
  label: string;
  iconClass: string;
}

export const PLATFORM_CONFIG: Record<PlatformKey, PlatformMeta> = {
  windows: { label: "Windows", iconClass: "fa-brands fa-windows" },
  linux: { label: "Linux", iconClass: "fa-brands fa-linux" },
  mac: { label: "macOS", iconClass: "fa-brands fa-apple" },
  chrome: { label: "Chrome / 拡張機能", iconClass: "fa-brands fa-chrome" },
  firefox: { label: "Firefox / アドオン", iconClass: "fa-brands fa-firefox-browser" },
};

