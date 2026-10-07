/**
 * Desk 404 brand assets, drawn as pixel grids and emitted as crisp SVG (+ PNG renders via sharp).
 *   npx tsx scripts/generate-brand.ts
 * Outputs to apps/web/public/brand/ and apps/web/src/app/ (favicon icon.svg, apple-icon.png).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "apps/web/public/brand");
mkdirSync(OUT, { recursive: true });

const C = {
  k: "#1a1915", // outline
  p: "#dedad0", // putty case
  h: "#fbfaf5", // bevel highlight
  s: "#8e897d", // bevel shadow
  n: "#1e3a5f", // screen
  m: "#1a3253", // scanline
  y: "#e8c25a", // token ink (bright, for the screen)
  w: "#fbfaf5", // white
  b: "#93b9ff", // SOL ink (bright, for the screen)
  g: "#2e9d5f", // power LED
  d: "#55514a", // floppy slot
  G: "#4d6f9c", // glass glare
} as const;
type Px = keyof typeof C;

/** 24×24 CRT monitor showing "404". */
function monitor(): (Px | null)[][] {
  const W = 24;
  const g: (Px | null)[][] = Array.from({ length: W }, () => Array<Px | null>(W).fill(null));
  const fill = (x0: number, y0: number, x1: number, y1: number, c: Px) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y]![x] = c;
  };
  // case with outline and 3D bevel
  fill(1, 1, 22, 17, "k");
  fill(2, 2, 21, 16, "p");
  fill(2, 2, 21, 2, "h");
  fill(2, 2, 2, 16, "h");
  fill(2, 16, 21, 16, "s");
  fill(21, 2, 21, 16, "s");
  // sunken bezel + screen with scanlines
  fill(4, 4, 19, 13, "n");
  for (let y = 5; y <= 13; y += 2) fill(4, y, 19, y, "m");
  fill(3, 3, 20, 3, "s");
  fill(3, 3, 3, 14, "s");
  fill(3, 14, 20, 14, "h");
  fill(20, 3, 20, 14, "h");
  // "404": 3×5 digits, first 4 in token ink, 0 white, last 4 in SOL ink
  const four = ["x.x", "x.x", "xxx", "..x", "..x"];
  const zero = ["xxx", "x.x", "x.x", "x.x", "xxx"];
  const draw = (glyph: string[], x0: number, y0: number, c: Px) => glyph.forEach((row, dy) => [...row].forEach((ch, dx) => ch === "x" && (g[y0 + dy]![x0 + dx] = c)));
  draw(four, 6, 6, "y");
  draw(zero, 10, 6, "w");
  draw(four, 14, 6, "b");
  // floppy slot + power LED
  fill(5, 15, 11, 15, "d");
  g[15]![18] = "g";
  // rounded pixel corners: case and screen (CRT glass)
  for (const [x, y] of [[1, 1], [22, 1], [1, 17], [22, 17]] as const) g[y]![x] = null;
  for (const [x, y] of [[2, 2], [21, 2], [2, 16], [21, 16]] as const) g[y]![x] = "k";
  g[4]![4] = "s";
  g[4]![19] = "s";
  g[13]![4] = "h";
  g[13]![19] = "h";
  // glare on the glass, top right
  g[5]![18] = "G";
  g[6]![18] = "G";
  g[5]![17] = "G";
  // stand
  fill(9, 18, 14, 19, "k");
  fill(10, 18, 13, 18, "s");
  fill(5, 20, 18, 21, "k");
  fill(6, 20, 17, 20, "p");
  return g;
}

/** 5×7 bitmap font for the wordmark (slashed zero, like an office terminal). */
const FONT: Record<string, string[]> = {
  D: ["xxxx.", "x...x", "x...x", "x...x", "x...x", "x...x", "xxxx."],
  E: ["xxxxx", "x....", "x....", "xxxx.", "x....", "x....", "xxxxx"],
  S: [".xxxx", "x....", "x....", ".xxx.", "....x", "....x", "xxxx."],
  K: ["x...x", "x..x.", "x.x..", "xx...", "x.x..", "x..x.", "x...x"],
  "4": ["...x.", "..xx.", ".x.x.", "x..x.", "xxxxx", "...x.", "...x."],
  "0": [".xxx.", "x...x", "x..xx", "x.x.x", "xx..x", "x...x", ".xxx."],
  " ": ["...", "...", "...", "...", "...", "...", "..."],
};

function wordmark(text: string, colorFor: (i: number) => string): Array<{ x: number; y: number; c: string }> {
  const px: Array<{ x: number; y: number; c: string }> = [];
  let x = 0;
  [...text].forEach((ch, i) => {
    const glyph = FONT[ch]!;
    glyph.forEach((row, y) => [...row].forEach((v, dx) => v === "x" && px.push({ x: x + dx, y, c: colorFor(i) })));
    x += glyph[0]!.length + 1;
  });
  return px;
}

/** Merge horizontal runs of the same colour into one rect: smaller, still pixel-exact. */
function rects(cells: Array<{ x: number; y: number; c: string }>, ox = 0, oy = 0): string {
  const byRow = new Map<number, Array<{ x: number; c: string }>>();
  for (const p of cells) byRow.set(p.y, [...(byRow.get(p.y) ?? []), { x: p.x, c: p.c }]);
  let out = "";
  for (const [y, row] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    row.sort((a, b) => a.x - b.x);
    let i = 0;
    while (i < row.length) {
      let j = i;
      while (j + 1 < row.length && row[j + 1]!.x === row[j]!.x + 1 && row[j + 1]!.c === row[i]!.c) j++;
      out += `<rect x="${row[i]!.x + ox}" y="${y + oy}" width="${j - i + 1}" height="1" fill="${row[i]!.c}"/>`;
      i = j + 1;
    }
  }
  return out;
}

const gridCells = (g: (Px | null)[][]) => g.flatMap((row, y) => row.flatMap((c, x) => (c ? [{ x, y, c: C[c] }] : [])));
const svg = (w: number, h: number, body: string, label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * 8}" height="${h * 8}" shape-rendering="crispEdges" role="img" aria-label="${label}">${body}</svg>\n`;

const mark = gridCells(monitor());
const markSvg = svg(24, 24, rects(mark), "Desk 404");

// Horizontal lockups: mark + wordmark ("DESK" in ink or white, "404" in screen navy / light blue).
const lockup = (dark: boolean) => {
  const text = wordmark("DESK 404", (i) => (i >= 5 ? (dark ? C.b : C.n) : dark ? C.w : C.k));
  const wordW = Math.max(...text.map((p) => p.x)) + 1;
  return svg(24 + 4 + wordW, 24, rects(mark) + rects(text, 28, 8), "Desk 404");
};

// Square app icon on a dithered desktop tile (for touch icons / social avatars).
const tile = () => {
  const dither = `<defs><pattern id="d" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="2" height="2" fill="#6b7f8c"/><rect width="1" height="1" fill="#5f7380"/><rect x="1" y="1" width="1" height="1" fill="#5f7380"/></pattern></defs><rect width="32" height="32" fill="url(#d)"/>`;
  return svg(32, 32, dither + rects(mark, 4, 4), "Desk 404");
};

const files: Record<string, string> = {
  "desk404-mark.svg": markSvg,
  "desk404-logo.svg": lockup(false),
  "desk404-logo-dark.svg": lockup(true),
  "desk404-tile.svg": tile(),
};
for (const [name, body] of Object.entries(files)) writeFileSync(join(OUT, name), body);

// Favicon (Next.js app-dir convention) and raster renders, nearest-neighbour so pixels stay square.
writeFileSync(join(ROOT, "apps/web/public/icon.svg"), markSvg);
const png = async (svgBody: string, size: number, file: string, w = size) => {
  await sharp(Buffer.from(svgBody), { density: 72 }).resize(w, size, { kernel: "nearest", fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(file);
};
await png(tile(), 180, join(ROOT, "apps/web/src/app/apple-icon.png"));
await png(tile(), 512, join(OUT, "desk404-tile-512.png"));
await png(markSvg, 512, join(OUT, "desk404-mark-512.png"));
const logoW = 24 + 4 + 47;
await png(lockup(false), 240, join(OUT, "desk404-logo-1200.png"), Math.round((240 / 24) * logoW));
console.log("Brand assets written to apps/web/public/brand");
