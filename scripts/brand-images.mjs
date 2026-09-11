/**
 * Renders the brand images into public/: the link-share previews (og-image.png in Swedish,
 * og-image-en.png in English, 1200×630) and the web app manifest icons (192, 512 and a maskable
 * 512 with the logo inside the safe zone). Drawn from HTML with the app's own font and colours, so
 * rerun it after changing the logo, tagline or palette.
 *
 * Usage: node scripts/brand-images.mjs
 */
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const root = new URL("../", import.meta.url);
const font = readFileSync(
  new URL("node_modules/@fontsource-variable/familjen-grotesk/files/familjen-grotesk-latin-wght-normal.woff2", root),
).toString("base64");
const fontExt = readFileSync(
  new URL("node_modules/@fontsource-variable/familjen-grotesk/files/familjen-grotesk-latin-ext-wght-normal.woff2", root),
).toString("base64");

const PINE = "#0f2a24";
const PINE_SOFT = "#5b6e69";
const FROST = "#f2f5f4";
const SOL = "#ffd23f";

const logo = (color, size) => `
  <svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none">
    <circle cx="16" cy="16" r="12.5" stroke="${color}" stroke-width="3.5" />
    <path d="M11.5 20.5L20.5 11.5" stroke="${color}" stroke-width="3.5" stroke-linecap="round" />
    <path d="M13.5 11.5H20.5V18.5" stroke="${color}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`;

const base = `
  <style>
    @font-face { font-family: "Familjen"; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 400 700; }
    @font-face { font-family: "Familjen"; src: url(data:font/woff2;base64,${fontExt}) format("woff2"); font-weight: 400 700; unicode-range: U+0100-024F, U+1E00-1EFF; }
    * { margin: 0; box-sizing: border-box; }
    body { font-family: "Familjen", sans-serif; }
  </style>`;

function ogHtml({ tagline, from, to, amount }) {
  return `${base}
  <style>
    body { width: 1200px; height: 630px; background: ${FROST}; color: ${PINE}; display: flex; flex-direction: column; justify-content: center; padding: 0 96px; gap: 40px; }
    .brand { display: flex; align-items: center; gap: 28px; font-size: 104px; font-weight: 650; letter-spacing: -0.02em; }
    .tagline { font-size: 44px; line-height: 1.25; color: ${PINE_SOFT}; max-width: 1010px; text-wrap: balance; }
    .row { display: flex; align-items: center; justify-content: space-between; width: 760px; background: #fff7d6; border: 2px solid ${SOL}; border-radius: 28px; padding: 30px 40px; font-size: 40px; font-weight: 600; }
    .names { display: flex; align-items: center; gap: 24px; }
    .arrow { width: 110px; height: 3px; background: ${PINE_SOFT}; position: relative; }
    .arrow::after { content: ""; position: absolute; right: -2px; top: -11px; width: 20px; height: 20px; border-top: 3px solid ${PINE_SOFT}; border-right: 3px solid ${PINE_SOFT}; transform: rotate(45deg); }
  </style>
  <div class="brand">${logo(PINE, 104)}Skyldig</div>
  <div class="tagline">${tagline}</div>
  <div class="row"><div class="names">${from}<span class="arrow"></span>${to}</div><div>${amount}</div></div>`;
}

function iconHtml(size, logoScale) {
  return `${base}
  <style>body { width: ${size}px; height: ${size}px; background: ${PINE}; display: grid; place-items: center; }</style>
  ${logo(FROST, Math.round(size * logoScale))}`;
}

const outputs = [
  { file: "og-image.png", w: 1200, h: 630, html: ogHtml({ tagline: "Dela utgifter med vänner – enkelt och utan konto.", from: "Johan", to: "Anna", amount: "438,35 kr" }) },
  { file: "og-image-en.png", w: 1200, h: 630, html: ogHtml({ tagline: "Split expenses with friends – simple, and no account needed.", from: "Johan", to: "Anna", amount: "SEK 438.35" }) },
  { file: "icon-192.png", w: 192, h: 192, html: iconHtml(192, 0.62) },
  { file: "icon-512.png", w: 512, h: 512, html: iconHtml(512, 0.62) },
  // Maskable icons are cropped to a circle as small as 80% of the canvas: keep the logo well inside.
  { file: "icon-maskable-512.png", w: 512, h: 512, html: iconHtml(512, 0.46) },
];

const browser = await chromium.launch();
for (const { file, w, h, html } of outputs) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(html);
  await page.evaluate("document.fonts.ready");
  await page.screenshot({ path: new URL(`public/${file}`, root).pathname });
  await page.close();
  console.log(`wrote public/${file}`);
}
await browser.close();
