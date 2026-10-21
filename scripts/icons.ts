// Renders the PWA icon set from SVG with Playwright's Chromium (already a dev
// dependency), so the PNGs in public/icons are reproducible:
//   nix develop --command node scripts/icons.ts
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const CREAM = "#fff4dc";
const RIM = "#efdcb0";
const INK = "#0a4a3c";
const CORAL = "#ff8f7d";
const NOSTRIL = "#c4574a";
const GRADIENT = `<defs><radialGradient id="bg" cx="28%" cy="18%" r="95%"><stop offset="0" stop-color="#14a37f"/><stop offset="1" stop-color="#095f4c"/></radialGradient></defs>`;

/**
 * divvy's piggy: a coin-faced piggy bank with ears, a coral snout and little
 * legs, drawn in a 512 box and centered by `fit` (scale around the middle).
 * `legs: false` for favicon sizes, where they'd only be noise.
 */
function piggy({ s = 1, legs = true, mono = false } = {}): string {
  // Monochrome: one opaque shape with the face cut out (the OS tints it).
  const body = mono ? "#000" : CREAM;
  const face = mono
    ? `<mask id="face"><rect width="512" height="512" fill="#fff"/><g fill="#000">
         <ellipse cx="204" cy="266" rx="15" ry="18.75"/><ellipse cx="308" cy="266" rx="15" ry="18.75"/>
         <ellipse cx="256" cy="322" rx="54" ry="38"/></g></mask>`
    : "";
  // The drawn mass sits low in the 512 box (ears on top, face below), so lift
  // it to the middle: with legs it spans ~106–450, head-only ~106–434.
  const dy = legs ? -22 : -14;
  return `${face}<g transform="translate(256 256) scale(${s}) translate(-256 ${-256 + dy})" ${mono ? 'mask="url(#face)"' : ""}>
    ${legs ? `<g fill="${body}"><rect x="182" y="404" width="40" height="46" rx="16"/><rect x="290" y="404" width="40" height="46" rx="16"/></g>` : ""}
    <g fill="${body}" stroke="${body}" stroke-width="20" stroke-linejoin="round"><path d="M154 186 L150 116 L220 154 Z"/><path d="M358 186 L362 116 L292 154 Z"/></g>
    ${mono ? "" : `<g fill="${CORAL}"><path d="M170 168 L170 138 L200 156 Z"/><path d="M342 168 L342 138 L312 156 Z"/></g>`}
    <circle cx="256" cy="286" r="148" fill="${body}"/>
    ${
      mono
        ? ""
        : `<circle cx="256" cy="286" r="128" fill="none" stroke="${RIM}" stroke-width="10"/>
    <g fill="${INK}"><ellipse cx="204" cy="266" rx="15" ry="18.75"/><ellipse cx="308" cy="266" rx="15" ry="18.75"/></g>
    <g fill="#fff"><circle cx="210" cy="258" r="5"/><circle cx="314" cy="258" r="5"/></g>
    <ellipse cx="256" cy="322" rx="54" ry="38" fill="${CORAL}"/>
    <g fill="${NOSTRIL}"><ellipse cx="238" cy="322" rx="9" ry="13"/><ellipse cx="274" cy="322" rx="9" ry="13"/></g>`
    }
  </g>`;
}
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>`;
const tile = (rx = 0) =>
  `${GRADIENT}<rect width="512" height="512" rx="${rx}" fill="url(#bg)"/>`;

const icons: Array<{ file: string; size: number; svg: string }> = [
  // "any": a rounded green tile with the piggy.
  ...[192, 512].map((size) => ({
    file: `icon-${size}.png`,
    size,
    svg: svg(`${tile(112)}${piggy({ s: 0.92 })}`),
  })),
  // Maskable: full bleed, piggy inside the 80% safe circle.
  {
    file: "icon-maskable-512.png",
    size: 512,
    svg: svg(`${tile()}${piggy({ s: 0.7 })}`),
  },
  // Monochrome: the silhouette alone.
  {
    file: "icon-monochrome-512.png",
    size: 512,
    svg: svg(piggy({ s: 0.8, mono: true })),
  },
  // iOS rounds the corners itself and needs an opaque square.
  {
    file: "apple-touch-icon.png",
    size: 180,
    svg: svg(`${tile()}${piggy({ s: 0.9 })}`),
  },
  // Favicon: just the face, as large as it fits.
  {
    file: "favicon-32.png",
    size: 32,
    svg: svg(`${tile(96)}${piggy({ s: 1.12, legs: false })}`),
  },
];
// App shortcuts (long-press the home screen icon): a white Lucide glyph on
// the full-bleed tile, inside the maskable safe circle.
const glyph = (paths: string) =>
  `<g transform="translate(256 256) scale(9) translate(-12 -12)" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`;
const SHORTCUTS = {
  // Lucide "plus".
  "shortcut-add": '<path d="M5 12h14"/><path d="M12 5v14"/>',
  // Lucide "arrow-left-right".
  "shortcut-settle":
    '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
};
for (const [name, paths] of Object.entries(SHORTCUTS))
  icons.push({
    file: `${name}-192.png`,
    size: 192,
    svg: svg(`${tile()}${glyph(paths)}`),
  });

// Vector copies for the browser tab and as the source of record.
writeFileSync(
  "public/favicon.svg",
  svg(`${tile(96)}${piggy({ s: 1.12, legs: false })}`),
);
writeFileSync(
  "public/icons/icon.svg",
  svg(`${tile(112)}${piggy({ s: 0.92 })}`),
);

const browser = await chromium.launch();
const page = await browser.newPage();
const pngs = new Map<string, Buffer>();
for (const icon of icons) {
  await page.setViewportSize({ width: icon.size, height: icon.size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${icon.size}px;height:${icon.size}px}</style>${icon.svg}`,
  );
  const png = await page.screenshot({ omitBackground: true });
  pngs.set(icon.file, png);
  writeFileSync(`public/icons/${icon.file}`, png);
}
await browser.close();

// favicon.ico: an ICO directory holding the 32px PNG as-is.
const png = pngs.get("favicon-32.png")!;
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // icon
header.writeUInt16LE(1, 4); // one image
header.writeUInt8(32, 6);
header.writeUInt8(32, 7);
header.writeUInt16LE(1, 10); // planes
header.writeUInt16LE(32, 12); // bits per pixel
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
writeFileSync("public/favicon.ico", Buffer.concat([header, png]));
console.log(`wrote ${icons.length} PNGs and favicon.ico`);
