/**
 * Tiny, dependency-free markdown → HTML renderer for guide content.
 * Supports exactly what the guide writer emits: ## headings, paragraphs,
 * **bold**, *italic*, [text](url) links (https or internal /go/ only),
 * unordered lists, and --- rules. Everything is HTML-escaped first.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(md: string): string {
  let out = escapeHtml(md);
  // Links first (URLs restricted to https or site-internal /go//guides).
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, text: string, href: string) => {
      const safe =
        href.startsWith("https://") ||
        href.startsWith("/go/") ||
        href.startsWith("/guides");
      if (!safe) return text;
      const rel = href.startsWith("/go/")
        ? ' rel="sponsored nofollow"'
        : ' rel="noopener"';
      const target = href.startsWith("https://") || href.startsWith("/go/")
        ? ' target="_blank"'
        : "";
      return `<a href="${href}"${rel}${target}>${text}</a>`;
    },
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return out;
}

export function renderGuideMarkdown(md: string): string {
  const blocks = md.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const html: string[] = [];
  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;
    if (block === "---") {
      html.push("<hr />");
      continue;
    }
    if (block.startsWith("## ")) {
      html.push(`<h2>${inline(block.slice(3))}</h2>`);
      continue;
    }
    if (block.startsWith("# ")) {
      html.push(`<h2>${inline(block.slice(2))}</h2>`);
      continue;
    }
    const lines = block.split("\n").map((l) => l.trim());
    if (lines.every((l) => l.startsWith("- ") || l.startsWith("* "))) {
      html.push(
        `<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join("")}</ul>`,
      );
      continue;
    }
    html.push(`<p>${lines.map(inline).join("<br />")}</p>`);
  }
  return html.join("\n");
}
