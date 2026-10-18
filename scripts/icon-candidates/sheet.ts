// Contact sheet for the icon candidates, rendered with Playwright's Chromium
// like scripts/icons.ts:
//   nix develop --command node scripts/icon-candidates/sheet.ts [subdir] [out.png]
import { readdirSync, readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const [sub = ".", out = "/tmp/divvy-icons/candidates.png"] =
  process.argv.slice(2);
const dir = new URL(`${sub}/`, import.meta.url);
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".svg"))
  .sort((a, b) => parseInt(a) - parseInt(b));
const uri = (f: string) =>
  `data:image/svg+xml;base64,${readFileSync(new URL(f, dir)).toString("base64")}`;

// iOS masks app icons to a rounded square (corner radius about 22.37%).
const icon = (f: string, size: number) =>
  `<img src="${uri(f)}" width="${size}" height="${size}" style="border-radius:${size * 0.2237}px;display:block">`;
const column = (f: string, i: number) => `
  <div class="col">
    <h2>${i + 1}. ${f.replace(/^\d+-/, "").replace(".svg", "").replaceAll("-", " ")}</h2>
    ${icon(f, 512)}
    <div class="home">${icon(f, 180)}<span>divvy</span></div>
    <div class="small">${icon(f, 48)}${icon(f, 32)}</div>
  </div>`;
const row = (name: string, bg: string, fg: string) => `
  <section style="background:${bg};color:${fg}">
    <h1>${name} wallpaper</h1>
    <div class="cols">${files.map(column).join("")}</div>
  </section>`;

const PER_ROW = 7;
const html = `<!doctype html><style>
  body{margin:0;font-family:-apple-system,system-ui,sans-serif}
  section{padding:32px}
  h1{margin:0 0 16px;font-size:28px}
  h2{margin:0 0 12px;font-size:24px;text-transform:capitalize}
  .cols{display:flex;flex-wrap:wrap;gap:40px;width:${PER_ROW * 552 - 40}px}
  .col{display:flex;flex-direction:column;align-items:center;gap:24px;width:512px}
  .home{display:flex;flex-direction:column;align-items:center;gap:8px;font-size:20px}
  .small{display:flex;gap:24px;align-items:center}
</style>${row("Light", "linear-gradient(135deg,#e9eef5,#f7e9e1)", "#1c1c1e")}${row("Dark", "linear-gradient(135deg,#1b1f3a,#0b0b0f)", "#f2f2f3")}`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 64 + Math.min(files.length, PER_ROW) * 552, height: 800 },
});
await page.setContent(html);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(`rendered ${files.length} candidates to ${out}`);
