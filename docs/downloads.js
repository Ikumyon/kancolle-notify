"use strict";

// 配布先が決まったら、この5つの空文字列に URL を設定してください。
// Windows はセットアップ用 .exe、Linux はセットアップ用 .sh を指定します。
const DOWNLOAD_URLS = Object.freeze({
  windows: "",
  linux: "",
  overlay: "",
  titleFetcher: "",
  relay: "",
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
  if (url.trim()) {
    link.href = url;
    link.removeAttribute("aria-disabled");
    link.removeAttribute("role");
    link.textContent = label;
  } else {
    link.removeAttribute("href");
    link.setAttribute("role", "link");
    link.setAttribute("aria-disabled", "true");
    link.textContent = "配布先準備中";
  }
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
  "オーバーレイをダウンロード");
updateDownload(document.getElementById("fetcher-download"), DOWNLOAD_URLS.titleFetcher,
  "KCO-title-fetcher をダウンロード");
updateDownload(document.getElementById("relay-download"), DOWNLOAD_URLS.relay,
  "KCO-relay をダウンロード");
