"use strict";

// Windows はセットアップ用 .exe、Linux はセットアップ用 .sh を指定します。
const DOWNLOAD_URLS = Object.freeze({
  windows: "https://github.com/Ikumyon/kancolle-notify/releases/latest/download/kancolle-notify-setup.exe",
  linux: "https://github.com/Ikumyon/kancolle-notify/releases/latest/download/install.sh",
  overlay: "https://github.com/Ikumyon/Kancolle-Stream-Overlay/archive/HEAD.zip",
  titleFetcher: "https://github.com/Ikumyon/KCO-title-fetcher/archive/refs/heads/main.zip",
  relay: "https://github.com/Ikumyon/KCO-relay/releases/latest/download/relay_app.exe",
});

const INSTALLERS = Object.freeze({
  windows: { label: "Windows", filename: "kancolle-notify-setup.exe" },
  linux: { label: "Linux", filename: "install.sh" },
});

function detectOS(platform, userAgent) {
  const environment = `${platform || ""} ${userAgent || ""}`;
  // Android / ChromeOS は Linux デスクトップ向けの配布対象にしません。
  return /linux/i.test(environment) && !/android|cros/i.test(environment)
    ? "linux"
    : "windows";
}

function updateDownload(link, url, label) {
  link.href = url;
  link.textContent = label;
}

const osButtons = document.querySelectorAll("[data-os]");
function selectOS(os) {
  const installer = INSTALLERS[os];
  for (const button of osButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.os === os));
  }
  document.getElementById("windows-guide").hidden = os !== "windows";
  document.getElementById("linux-guide").hidden = os !== "linux";
  document.getElementById("notify-file").textContent =
    `${installer.label} 用 · ${installer.filename}`;
  updateDownload(document.getElementById("notify-download"), DOWNLOAD_URLS[os],
    `${installer.label} 用セットアップをダウンロード`);
}

for (const button of osButtons) {
  button.disabled = false;
  button.addEventListener("click", () => selectOS(button.dataset.os));
}
selectOS(detectOS(navigator.userAgentData?.platform || navigator.platform, navigator.userAgent));
updateDownload(document.getElementById("overlay-download"), DOWNLOAD_URLS.overlay,
  "オーバーレイをダウンロード（ZIP）");
updateDownload(document.getElementById("fetcher-download"), DOWNLOAD_URLS.titleFetcher,
  "KCO-title-fetcher をダウンロード（ZIP）");
updateDownload(document.getElementById("relay-download"), DOWNLOAD_URLS.relay,
  "KCO-relay をダウンロード（EXE）");
