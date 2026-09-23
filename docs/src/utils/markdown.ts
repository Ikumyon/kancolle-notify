import { marked } from "marked";
import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  securityLevel: "loose",
  fontFamily: 'Inter, "Noto Sans JP", sans-serif',
});

let mermaidCounter = 0;

/**
 * Markdown文字列をHTMLへ変換し、CSS設計（テーブルコンテナ、コピーボタン、Mermaid等）に合わせた装飾を適用します。
 */
export async function renderMarkdown(
  mdText: string,
  basePath: string
): Promise<string> {
  const customRenderer = new marked.Renderer();

  // 相対画像パスをツール基準パスに解決
  customRenderer.image = function ({ href, title, text }) {
    let resolvedHref = href;
    if (resolvedHref && !resolvedHref.startsWith("http") && !resolvedHref.startsWith("/")) {
      resolvedHref = `${basePath}/${resolvedHref}`;
    }
    const titleAttr = title ? ` title="${title}"` : "";
    return `<img class="markdown-img" src="${resolvedHref}" alt="${text}"${titleAttr} loading="lazy">`;
  };

  // コードブロックの処理（Mermaid対応とコピーボタン）
  customRenderer.code = function ({ text, lang }) {
    if (lang === "mermaid") {
      const id = `mermaid-diagram-${++mermaidCounter}`;
      return `<div class="mermaid" id="${id}" data-code="${encodeURIComponent(text)}"></div>`;
    }
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const langClass = lang ? ` class="language-${lang}"` : "";

    return `
      <div class="code-block-container">
        <button class="code-copy-btn" type="button" aria-label="コードをコピー">
          <i class="fa-regular fa-copy"></i> <span>コピー</span>
        </button>
        <pre><code${langClass}>${escaped}</code></pre>
      </div>
    `;
  };

  marked.use({
    renderer: customRenderer,
    hooks: {
      postprocess(html) {
        // tableタグを .table-container でラップ
        return html.replace(/<table>/g, '<div class="table-container"><table>')
                   .replace(/<\/table>/g, '</table></div>');
      },
    },
  });

  const html = await marked.parse(mdText, { async: true });
  return html;
}

/**
 * レンダリング後のDOM内のMermaidダイアグラムとコピーボタンを初期化します。
 */
export async function setupRenderedMarkdownEffects(container: HTMLElement): Promise<void> {
  // 1. コピーボタンの挙動設定
  const copyButtons = container.querySelectorAll<HTMLButtonElement>(".code-copy-btn");
  for (const btn of copyButtons) {
    btn.addEventListener("click", async () => {
      const codeEl = btn.closest(".code-block-container")?.querySelector("code");
      if (!codeEl) return;
      const textToCopy = codeEl.textContent || "";
      try {
        await navigator.clipboard.writeText(textToCopy);
        const originalHtml = btn.innerHTML;
        btn.classList.add("copied");
        btn.innerHTML = `<i class="fa-solid fa-check"></i> <span>コピー完了</span>`;
        setTimeout(() => {
          btn.classList.remove("copied");
          btn.innerHTML = originalHtml;
        }, 2000);
      } catch (err) {
        console.error("クリップボードへのコピーに失敗しました:", err);
      }
    });
  }

  // 2. Mermaidレンダリング
  const mermaidNodes = container.querySelectorAll<HTMLElement>(".mermaid");
  for (const node of mermaidNodes) {
    const rawCode = node.getAttribute("data-code");
    if (!rawCode) continue;
    const code = decodeURIComponent(rawCode);
    const diagramId = `rendered-${node.id || Math.random().toString(36).slice(2)}`;
    try {
      const { svg } = await mermaid.render(diagramId, code);
      node.innerHTML = svg;
    } catch (e) {
      console.warn("Mermaidレンダリング警告:", e);
      node.innerHTML = `<pre class="mermaid-fallback"><code>${code}</code></pre>`;
    }
  }
}
