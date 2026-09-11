/**
 * Server-rendered HTML for the admin app. Every interpolated value is escaped unless it is
 * already `SafeHtml` built by these helpers, so injection is prevented by default rather than by
 * remembering to escape. There is no client-side JavaScript at all (CSP `script-src 'none'`).
 */
import type { AdminLocale, AdminMessages } from "./i18n.ts";

export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export function esc(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function render(value: unknown): string {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join("");
  if (value === null || value === undefined || value === false) return "";
  return esc(value);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0] ?? "";
  values.forEach((value, i) => {
    out += render(value) + (strings[i + 1] ?? "");
  });
  return new SafeHtml(out);
}

export interface Formatters {
  number(value: number): string;
  percent(value: number): string;
  bytes(value: number): string;
  dateTime(value: Date): string;
  date(value: Date): string;
}

export function formatters(locale: AdminLocale, timeZone: string): Formatters {
  const tag = locale === "en" ? "en-GB" : "sv-SE";
  const num = new Intl.NumberFormat(tag);
  const pct = new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: 0 });
  const mb = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
  const dt = new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short", timeZone });
  const d = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone });
  return {
    number: (v) => num.format(v),
    percent: (v) => pct.format(v),
    bytes: (v) => `${mb.format(v / (1024 * 1024))} MB`,
    dateTime: (v) => dt.format(v),
    date: (v) => d.format(v),
  };
}

export type Section = "overview" | "maintenance" | "group" | "log";

const PATHS: Record<Section, string> = {
  overview: "/",
  maintenance: "/underhall",
  group: "/grupp",
  log: "/logg",
};

export function href(path: string, locale: AdminLocale, params: Record<string, string> = {}): string {
  const query = new URLSearchParams({ ...params, lang: locale });
  return `${path}?${query.toString()}`;
}

export function page(options: {
  t: AdminMessages;
  locale: AdminLocale;
  user: string;
  active: Section | null;
  title: string;
  path: string;
  content: SafeHtml;
}): string {
  const { t, locale, user, active, title, path, content } = options;
  const other: AdminLocale = locale === "sv" ? "en" : "sv";
  const nav = (Object.keys(PATHS) as Section[]).map(
    (section) =>
      html`<a href="${href(PATHS[section], locale)}"${active === section ? new SafeHtml(' aria-current="page"') : ""}>${t.nav[section]}</a>`,
  );
  return `<!doctype html>${html`<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title} · ${t.title}</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<a class="skip" href="#main">${t.skip}</a>
<header class="top">
  <strong class="brand">${t.title}</strong>
  <nav aria-label="${t.title}">${nav}</nav>
  <span class="who">${t.signedInAs({ user })}</span>
  <a class="lang" href="${href(path, other)}" lang="${other}">${other === "en" ? "English" : "Svenska"}</a>
</header>
<main id="main">
<h1>${title}</h1>
${content}
<p class="privacy">${t.privacyNote}</p>
</main>
</body>
</html>`}`;
}

export function tile(label: string, value: string, detail?: string): SafeHtml {
  return html`<div class="tile"><p class="label">${label}</p><p class="value">${value}</p>${
    detail ? html`<p class="detail">${detail}</p>` : ""
  }</div>`;
}

export function notice(text: string, kind: "info" | "error" = "info"): SafeHtml {
  return html`<p class="notice ${kind}" role="${kind === "error" ? "alert" : "status"}">${text}</p>`;
}

export function table(caption: string | null, headers: string[], rows: (string | SafeHtml)[][]): SafeHtml {
  return html`<div class="scroll"><table>${caption ? html`<caption>${caption}</caption>` : ""}<thead><tr>${headers.map(
    (h) => html`<th scope="col">${h}</th>`,
  )}</tr></thead><tbody>${rows.map((row) => html`<tr>${row.map((cell) => html`<td>${cell}</td>`)}</tr>`)}</tbody></table></div>`;
}

/**
 * A small bar chart drawn as SVG on the server, one bar per day. Each bar carries a <title>
 * (a native tooltip, no JavaScript); the same numbers are available as a table for screen readers
 * and anyone who wants exact values.
 */
export function barChart(label: string, days: string[], values: number[], fmt: Formatters): SafeHtml {
  const width = 600;
  const height = 120;
  const pad = 22;
  const max = Math.max(1, ...values);
  const barWidth = (width - pad) / values.length;
  const bars = values.map((value, i) => {
    const h = (value / max) * (height - pad);
    const x = pad + i * barWidth + 1;
    const y = height - pad - h;
    return html`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, barWidth - 2).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="#0f2a24"><title>${days[i]}: ${fmt.number(value)}</title></rect>`;
  });
  return html`<figure class="chart">
<figcaption>${label}</figcaption>
<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">
<line x1="${pad}" y1="${height - pad}" x2="${width}" y2="${height - pad}" stroke="#c9d1cf"/>
<text x="0" y="10" font-size="11" fill="#5b6e69">${fmt.number(max)}</text>
<text x="0" y="${height - pad}" font-size="11" fill="#5b6e69">0</text>
${bars}
<text x="${pad}" y="${height - 4}" font-size="11" fill="#5b6e69">${days[0] ?? ""}</text>
<text x="${width}" y="${height - 4}" font-size="11" fill="#5b6e69" text-anchor="end">${days[days.length - 1] ?? ""}</text>
</svg>
</figure>`;
}

export const STYLES = `
:root { color-scheme: light; --pine: #0f2a24; --soft: #5b6e69; --frost: #f2f5f4; --paper: #fff; --sol: #ffd23f; --rust: #a82f18; --line: #dfe5e3; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--frost); color: var(--pine); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
a { color: var(--pine); }
:focus-visible { outline: 2px solid var(--pine); outline-offset: 2px; }
.skip { position: absolute; left: -999px; }
.skip:focus { left: 8px; top: 8px; background: var(--paper); padding: 8px 12px; }
.top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px; padding: 12px 24px; background: var(--paper); border-bottom: 1px solid var(--line); }
.brand { font-size: 16px; }
.top nav { display: flex; flex-wrap: wrap; gap: 4px; }
.top nav a { text-decoration: none; padding: 6px 10px; border-radius: 8px; color: var(--soft); }
.top nav a:hover { background: var(--frost); color: var(--pine); }
.top nav a[aria-current="page"] { background: rgba(255, 210, 63, .45); color: var(--pine); font-weight: 600; }
.who { margin-left: auto; color: var(--soft); font-size: 13px; }
.lang { font-size: 13px; }
main { max-width: 1040px; margin: 0 auto; padding: 24px; }
h1 { font-size: 28px; margin: 8px 0 20px; }
h2 { font-size: 18px; margin: 32px 0 12px; }
.lead { color: var(--soft); max-width: 65ch; }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.tile { background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
.tile p { margin: 0; }
.tile .label { color: var(--soft); font-size: 13px; }
.tile .value { font-size: 26px; font-weight: 650; font-variant-numeric: tabular-nums; }
.tile .detail { color: var(--soft); font-size: 13px; }
.charts { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.chart { margin: 0; background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
.chart figcaption { font-size: 13px; color: var(--soft); margin-bottom: 6px; }
.chart svg { width: 100%; height: auto; display: block; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; background: var(--paper); border: 1px solid var(--line); border-radius: 12px; font-variant-numeric: tabular-nums; }
caption { text-align: left; font-weight: 600; padding: 0 0 8px; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
th { font-size: 13px; color: var(--soft); font-weight: 600; }
details { margin-top: 12px; }
summary { cursor: pointer; color: var(--soft); }
form { display: grid; gap: 12px; max-width: 460px; }
label { font-weight: 600; }
.hint { color: var(--soft); font-size: 13px; font-weight: 400; }
input, textarea { font: inherit; padding: 10px 12px; border: 1px solid #c9d1cf; border-radius: 8px; background: var(--paper); color: var(--pine); width: 100%; }
textarea { min-height: 80px; }
button { font: inherit; font-weight: 600; min-height: 44px; padding: 0 20px; border-radius: 8px; border: 1px solid var(--pine); background: var(--pine); color: var(--paper); cursor: pointer; justify-self: start; }
button.danger { background: var(--rust); border-color: var(--rust); }
.card { background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 16px 20px; }
.danger-zone { border-color: var(--rust); }
form + .card, form + .notice, .notice + form { margin-top: 16px; }
dl.meta { display: grid; grid-template-columns: max-content 1fr; gap: 6px 20px; margin: 0; }
dl.meta dt { color: var(--soft); }
dl.meta dd { margin: 0; font-variant-numeric: tabular-nums; }
.notice { padding: 10px 14px; border-radius: 8px; background: var(--paper); border: 1px solid var(--line); }
.notice.error { border-color: var(--rust); color: var(--rust); }
.privacy { margin-top: 40px; color: var(--soft); font-size: 13px; }
.ok { color: #136437; font-weight: 600; }
.bad { color: var(--rust); font-weight: 600; }
`;
