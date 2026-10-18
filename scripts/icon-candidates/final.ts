// Preview of the shipped icon set (public/icons):
//   nix develop --command node scripts/icon-candidates/final.ts
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const uri = (path: string, type = "image/png") =>
  `data:${type};base64,${readFileSync(path).toString("base64")}`;
const any = uri("public/icons/icon-512.png");
const touch = uri("public/icons/apple-touch-icon.png");
const fav = uri("public/favicon.svg", "image/svg+xml");
const masked = (src: string, size: number) =>
  `<img src="${src}" width="${size}" height="${size}" style="border-radius:${size * 0.2237}px;display:block">`;
const row = (name: string, bg: string, fg: string) => `
  <section style="background:${bg};color:${fg}">
    <h1>${name} wallpaper</h1>
    <div class="row">
      ${masked(any, 512)}
      <div class="home">${masked(touch, 180)}<span>divvy</span></div>
      <div class="home">${masked(any, 48)}${masked(any, 32)}</div>
    </div>
  </section>`;
const html = `<!doctype html><style>
  body{margin:0;font-family:-apple-system,system-ui,sans-serif}
  section{padding:32px}
  h1{margin:0 0 16px;font-size:28px}
  .row{display:flex;gap:48px;align-items:center}
  .home{display:flex;flex-direction:column;align-items:center;gap:10px;font-size:20px}
  .tabs{background:#dee1e6;padding:12px 16px 0;display:flex;gap:4px}
  .tab{display:flex;align-items:center;gap:10px;background:#fff;border-radius:10px 10px 0 0;padding:10px 16px;width:240px;font-size:15px;color:#202124}
  .tab.off{background:transparent;color:#5f6368}
  .bar{background:#fff;padding:10px 16px;border-bottom:1px solid #dadce0;font-size:15px;color:#5f6368}
</style>
${row("Light", "linear-gradient(135deg,#e9eef5,#f7e9e1)", "#1c1c1e")}
${row("Dark", "linear-gradient(135deg,#1b1f3a,#0b0b0f)", "#f2f2f3")}
<section style="padding:32px 32px 48px;background:#f5f5f5">
  <h1>Browser tab</h1>
  <div class="tabs"><div class="tab"><img src="${fav}" width="16" height="16">Home · divvy</div>
  <div class="tab off"><span style="width:16px;height:16px;border-radius:50%;background:#9aa0a6;display:inline-block"></span>Another site</div></div>
  <div class="bar">divvy.example.com</div>
</section>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
await page.setContent(html);
await page.screenshot({ path: "/tmp/divvy-icons/final.png", fullPage: true });
await browser.close();
console.log("wrote /tmp/divvy-icons/final.png");
