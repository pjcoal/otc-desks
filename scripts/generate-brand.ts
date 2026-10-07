/**
 * Desk 404 brand assets, drawn as pixel grids and emitted as crisp SVG (+ PNG renders via sharp).
 * Style: 3/4-view beige office computer, shaded (no outlines), dark CRT with green "404",
 * keyboard base with a red LED; avatar tile on charcoal with a long diagonal shadow.
 *   npx tsx scripts/generate-brand.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "apps/web/public/brand");
mkdirSync(OUT, { recursive: true });

const C = {
  T: "#f6eee1", // top faces / highlights
  F: "#e9dfcd", // front face
  f: "#ddd2be", // front face, lower shade
  S: "#c9bca6", // side face
  s: "#b4a68f", // side face, deep shade / undersides
  B: "#8d8780", // screen bezel
  b: "#6f6a64", // bezel inner shade
  K: "#141414", // screen / slot
  k: "#1f1f1f", // screen scanline
  G: "#6bd873", // CRT green
  E: "#b8afa3", // keys
  e: "#9d958a", // key shade
  A: "#e8a33a", // amber power LED
  Y: "#f2d45c", // sticky note
  y: "#d4b440", // sticky note shade
  n: "#8a7a2c", // handwriting on the note
} as const;
type Px = keyof typeof C;
type Grid = (Px | null)[][];

const W = 48;
const H = 44;

function computer(): Grid {
  const g: Grid = Array.from({ length: H }, () => Array<Px | null>(W).fill(null));
  const fill = (x0: number, y0: number, x1: number, y1: number, c: Px) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (y >= 0 && y < H && x >= 0 && x < W) g[y]![x] = c;
  };

  // ── CRT monitor (faces right; depth on the left) ──
  for (let i = 0; i < 5; i++) fill(13 - i, 6 + i, 13 - i, 27, i < 2 ? "S" : "s"); // left side face
  for (let i = 0; i < 5; i++) fill(13 - i, 4 + i, 13 - i, 5 + i, "T"); // stepped top edge
  fill(14, 4, 37, 5, "T"); // top face
  fill(14, 6, 37, 27, "F"); // front face
  fill(14, 24, 37, 27, "f");
  fill(37, 6, 37, 27, "f"); // right edge in shade (light from the left)
  fill(14, 27, 37, 27, "s");
  // bezel + screen with scanlines
  fill(17, 8, 34, 21, "B");
  fill(17, 8, 34, 8, "b");
  fill(17, 8, 17, 21, "b");
  fill(18, 9, 33, 20, "K");
  for (let y = 10; y <= 20; y += 2) fill(18, y, 33, y, "k");
  // "404" + cursor in CRT green
  const four = ["x..x", "x..x", "x..x", "xxxx", "...x", "...x"];
  const zero = ["xxxx", "x..x", "x..x", "x..x", "x..x", "xxxx"];
  for (const [glyph, x0] of [
    [four, 19],
    [zero, 24],
    [four, 29],
  ] as Array<[string[], number]>)
    glyph.forEach((row, dy) => [...row].forEach((ch, dx) => ch === "x" && (g[11 + dy]![x0 + dx] = "G")));
  fill(19, 18, 21, 18, "G"); // cursor
  // control buttons under the screen
  fill(31, 24, 32, 24, "E");
  fill(34, 24, 35, 24, "E");
  // sticky note on the top-right corner
  fill(32, 3, 38, 8, "Y");
  fill(32, 8, 38, 8, "y");
  fill(33, 4, 37, 4, "n");
  fill(33, 6, 35, 6, "n");
  // neck
  fill(21, 28, 30, 29, "s");

  // ── flat desktop case underneath ──
  for (let i = 0; i < 4; i++) fill(7 - i, 31 + i, 7 - i, 37, "s"); // left side
  for (let i = 0; i < 4; i++) fill(7 - i, 30 + i, 7 - i, 30 + i, "T");
  fill(8, 30, 41, 31, "T"); // top
  fill(8, 32, 41, 37, "F"); // front
  fill(8, 37, 41, 37, "f");
  fill(41, 32, 41, 37, "f");
  fill(8, 38, 41, 38, "s"); // underside
  fill(11, 34, 22, 34, "K"); // floppy drive
  fill(11, 35, 22, 35, "s");
  fill(12, 33, 13, 33, "E"); // drive eject button
  fill(33, 34, 34, 35, "E"); // power button
  fill(37, 34, 38, 34, "A"); // amber power LED
  return g;
}

const cells = (g: Grid, ox = 0, oy = 0) => g.flatMap((row, y) => row.flatMap((c, x) => (c ? [{ x: x + ox, y: y + oy, c: C[c] as string }] : [])));

/** Merge horizontal runs of one colour into a single rect: smaller files, still pixel-exact. */
function rects(list: Array<{ x: number; y: number; c: string }>): string {
  const byRow = new Map<number, Array<{ x: number; c: string }>>();
  for (const p of list) byRow.set(p.y, [...(byRow.get(p.y) ?? []), { x: p.x, c: p.c }]);
  let out = "";
  for (const [y, row] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    row.sort((a, b) => a.x - b.x);
    let i = 0;
    while (i < row.length) {
      let j = i;
      while (j + 1 < row.length && row[j + 1]!.x === row[j]!.x + 1 && row[j + 1]!.c === row[i]!.c) j++;
      out += `<rect x="${row[i]!.x}" y="${y}" width="${j - i + 1}" height="1" fill="${row[i]!.c}"/>`;
      i = j + 1;
    }
  }
  return out;
}

const svg = (w: number, h: number, body: string, scale = 8) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges" role="img" aria-label="Desk 404">${body}</svg>\n`;

const grid = computer();
// Crop to the drawn bounds for the transparent mark.
const all = cells(grid);
const minX = Math.min(...all.map((p) => p.x));
const maxX = Math.max(...all.map((p) => p.x));
const minY = Math.min(...all.map((p) => p.y));
const maxY = Math.max(...all.map((p) => p.y));
const markW = maxX - minX + 1;
const markH = maxY - minY + 1;
const side = Math.max(markW, markH);
const padX = Math.floor((side - markW) / 2);
const padY = Math.floor((side - markH) / 2);
const markCells = all.map((p) => ({ ...p, x: p.x - minX + padX, y: p.y - minY + padY }));
const markSvg = svg(side, side, rects(markCells), 6);

/** Avatar tile: the site's dithered desktop pattern with a short, hard drop shadow. */
function tile(size = 64): string {
  const ox = Math.floor((size - markW) / 2) - 1;
  const oy = Math.floor((size - markH) / 2) - 1;
  const objCells = markCells.map((p) => ({ ...p, x: p.x - padX + ox, y: p.y - padY + oy }));
  const shadowCells = objCells.map((p) => ({ x: p.x + 2, y: p.y + 2, c: "rgba(0,0,0,0.35)" }));
  const dither = `<defs><pattern id="d" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="2" height="2" fill="#6b7f8c"/><rect width="1" height="1" fill="#5f7380"/><rect x="1" y="1" width="1" height="1" fill="#5f7380"/></pattern></defs><rect width="${size}" height="${size}" fill="url(#d)"/>`;
  return svg(size, size, dither + rects(shadowCells) + rects(objCells), 8);
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
function word(text: string, colorFor: (i: number) => string, ox: number, oy: number, scale: number) {
  const out: Array<{ x: number; y: number; c: string }> = [];
  let x = 0;
  [...text].forEach((ch, i) => {
    const glyph = FONT[ch]!;
    glyph.forEach((row, y) =>
      [...row].forEach((v, dx) => {
        if (v !== "x") return;
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) out.push({ x: ox + (x + dx) * scale + sx, y: oy + y * scale + sy, c: colorFor(i) });
      }),
    );
    x += glyph[0]!.length + 1;
  });
  return { cells: out, width: x * scale };
}

/** Horizontal lockup: computer + "DESK 404" (404 in CRT green). */
function lockup(dark: boolean): string {
  const text = word("DESK 404", (i) => (i >= 5 ? (dark ? "#6bd873" : "#2f7a37") : dark ? "#f6eee1" : "#1a1915"), side + 6, Math.floor((side - 14) / 2), 2);
  const w = side + 6 + text.width;
  return svg(w, side, rects(markCells) + rects(text.cells), 6);
}

const files: Record<string, string> = {
  "desk404-mark.svg": markSvg,
  "desk404-logo.svg": lockup(false),
  "desk404-logo-dark.svg": lockup(true),
  "desk404-tile.svg": tile(),
};
for (const [name, body] of Object.entries(files)) writeFileSync(join(OUT, name), body);
writeFileSync(join(ROOT, "apps/web/public/icon.svg"), markSvg);

const png = async (body: string, height: number, file: string) => {
  const meta = /viewBox="0 0 (\d+) (\d+)"/.exec(body)!;
  const width = Math.round((Number(meta[1]) / Number(meta[2])) * height);
  await sharp(Buffer.from(body), { density: 72 }).resize(width, height, { kernel: "nearest" }).png().toFile(file);
};
await png(tile(), 180, join(ROOT, "apps/web/src/app/apple-icon.png"));
await png(tile(), 512, join(OUT, "desk404-tile-512.png"));
await png(markSvg, 512, join(OUT, "desk404-mark-512.png"));
await png(lockup(false), 240, join(OUT, "desk404-logo-1200.png"));
await png(lockup(true), 240, join(OUT, "desk404-logo-dark-1200.png"));
console.log("Brand assets written to apps/web/public/brand");
