// Open Design 0.26 forces its own appearance back to light. The embedded host
// owns chrome appearance; artifact documents remain separate, unmodified frames.
export const DESIGN_APPEARANCE_SCRIPT = `(() => {
  const root = document.documentElement;
  const apply = () => {
    root.setAttribute('data-meowsh-ui', 'dark');
    if (root.getAttribute('data-theme') !== 'dark') root.setAttribute('data-theme', 'dark');
  };
  apply();
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
})();`;

export const DESIGN_APPEARANCE_CSS = `
html[data-meowsh-ui="dark"] {
  --bg: #181b1a; --bg-app: #181b1a; --bg-panel: #222724;
  --bg-subtle: #2c332f; --bg-muted: #39423c; --bg-elevated: #272e29;
  --text: #e0e7e2; --text-strong: #f4f7f5; --text-muted: #b3beb7;
  --text-soft: #9aa79f; --text-faint: #87958b; --select-ink: #f4f7f5;
  --border: #3c473f; --border-strong: #647368; --border-soft: #303a33;
  --veil-shell: var(--bg-app); --veil-page: var(--bg); --veil-canvas: var(--bg);
  --veil-panel: var(--bg-panel); --entry-ground: var(--bg);
  --code-header-bg: #222724; --code-body-bg: #151916;
  --accent: #e0e7e2 !important; --accent-contrast: #181b1a;
  --accent-strong: #f4f7f5 !important; --accent-hover: #f4f7f5 !important;
  --accent-soft: #39423c !important; --accent-tint: #2c332f !important;
}
html[data-meowsh-ui="dark"] [data-chat-root] {
  --chat-floating-card-bg: var(--bg-panel);
  --chat-floating-card-text: var(--text-strong);
  --chat-confirm-surface: var(--bg-panel);
  --chat-plan-current-text: var(--text);
}
html[data-meowsh-ui="dark"] .df-empty,
html[data-meowsh-ui="dark"] .viewer-toolbar,
html[data-meowsh-ui="dark"] .comment-side-panel,
html[data-meowsh-ui="dark"] .comment-side-header,
html[data-meowsh-ui="dark"] .chrome-unified-popover--share {
  background: var(--bg-panel); color: var(--text); border-color: var(--border);
}
html[data-meowsh-ui="dark"] .comment-side-title { color: var(--text-strong); }
html[data-meowsh-ui="dark"] .viewer-comment-count-trigger {
  background: var(--bg-subtle); color: var(--text);
}
html[data-meowsh-ui="dark"] .df-row.selected { background: #314635; }
html[data-meowsh-ui="dark"] .df-row.selected .df-row-name,
html[data-meowsh-ui="dark"] .df-row.selected .df-row-check { color: var(--text-strong); }
html[data-meowsh-ui="dark"] .df-row.selected .df-row-sub,
html[data-meowsh-ui="dark"] .df-row.selected .df-row-size,
html[data-meowsh-ui="dark"] .df-row.selected .df-row-time { color: var(--text-muted); }
/* Preserve the original preview media environment, not the host chrome's theme. */
html[data-meowsh-ui="dark"] iframe { color-scheme: light; }
`;

export function decorateDesignDocument(html: string): string {
  return html.replace(
    /<\/head\s*>/i,
    '<link rel="stylesheet" href="/__meowsh/appearance.css"><script src="/__meowsh/appearance.js"></script></head>',
  );
}
