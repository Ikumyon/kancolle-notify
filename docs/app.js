/**
 * kancolle-notify - Landing Page Script
 * Features:
 * - Theme Switcher (Light / Dark / OS Auto)
 * - Persistent Theme in localStorage
 * - Clipboard Copy for Code Snippets
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'kancolle_notify_theme';
  const themeToggleBtn = document.getElementById('theme-toggle');
  const rootHtml = document.documentElement;

  // 1. Initial Theme Setup
  function getPreferredTheme() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
    // Check OS preference
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    if (theme === 'dark') {
      rootHtml.setAttribute('data-theme', 'dark');
    } else {
      rootHtml.setAttribute('data-theme', 'light');
    }
  }

  // Set theme immediately
  const initialTheme = getPreferredTheme();
  applyTheme(initialTheme);

  // 2. Toggle Theme Event
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const current = rootHtml.getAttribute('data-theme');
      const nextTheme = current === 'dark' ? 'light' : 'dark';
      applyTheme(nextTheme);
      localStorage.setItem(STORAGE_KEY, nextTheme);
    });
  }

  // 3. Listen to OS preference changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    // Only auto-change if user hasn't explicitly set preference
    if (!localStorage.getItem(STORAGE_KEY)) {
      applyTheme(e.matches ? 'dark' : 'light');
    }
  });

  // 4. Clipboard Copy
  const copyButtons = document.querySelectorAll('.copy-btn');
  copyButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.getAttribute('data-clipboard');
      if (!text) return;

      try {
        await navigator.clipboard.writeText(text);
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check" style="color: var(--accent-emerald);"></i>';
        btn.setAttribute('title', 'コピー完了！');

        setTimeout(() => {
          btn.innerHTML = originalHtml;
          btn.setAttribute('title', 'コピー');
        }, 2000);
      } catch (err) {
        console.error('Clipboard copy failed:', err);
      }
    });
  });

  // 5. Fetch Latest Release Version from GitHub API
  async function fetchLatestRelease() {
    const REPO = 'Ikumyon/kancolle-notify';
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=5`);
      if (!res.ok) return;
      const releases = await res.json();
      if (!Array.isArray(releases) || releases.length === 0) return;

      const latest = releases.find((r) => !r.draft) || releases[0];
      if (!latest || !latest.tag_name) return;

      const tagName = latest.tag_name;
      const cleanVer = tagName.startsWith('v') ? tagName : `v${tagName}`;
      const upperVer = `VERSION ${cleanVer.replace(/^v/, '')}`;

      document.querySelectorAll('.js-version-tag').forEach((el) => {
        el.textContent = cleanVer;
      });
      document.querySelectorAll('.js-version-bracket').forEach((el) => {
        el.textContent = `(${cleanVer})`;
      });
      document.querySelectorAll('.js-version-upper').forEach((el) => {
        el.textContent = upperVer;
      });
    } catch (e) {
      console.debug('Could not fetch latest release version:', e);
    }
  }

  fetchLatestRelease();

})();

