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
  R: "#d63a2f", // power LED
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

  // ── monitor box ──
  // side face (depth to the right, stepped top edge for the 3/4 view)
  for (let i = 0; i < 6; i++) fill(34 + i, 6 + i, 34 + i, 30, i < 2 ? "S" : "s");
  // top face: light strip with a stepped right end
  fill(10, 4, 33, 5, "T");
  for (let i = 0; i < 6; i++) fill(34 + i, 4 + i, 34 + i, 5 + i, "T");
  // front face
  fill(10, 6, 33, 30, "F");
  fill(10, 27, 33, 30, "f");
  fill(10, 6, 10, 30, "T"); // left highlight edge
  fill(11, 30, 33, 30, "s"); // underside
  // bezel + screen
  fill(13, 9, 30, 23, "B");
  fill(13, 9, 30, 9, "b");
  fill(13, 9, 13, 23, "b");
  fill(14, 10, 29, 22, "K");
  for (let y = 11; y <= 22; y += 2) fill(14, y, 29, y, "k");
  // "404": 4×6 digits in CRT green
  const four = ["x..x", "x..x", "x..x", "xxxx", "...x", "...x"];
  const zero = ["xxxx", "x..x", "x..x", "x..x", "x..x", "xxxx"];
  const glyphs: Array<[string[], number]> = [
    [four, 15],
    [zero, 20],
    [four, 25],
  ];
  for (const [glyph, x0] of glyphs) glyph.forEach((row, dy) => [...row].forEach((ch, dx) => ch === "x" && (g[14 + dy]![x0 + dx] = "G")));
  // floppy slot under the screen
  fill(15, 26, 24, 26, "K");
  fill(15, 27, 24, 27, "s");

  // ── keyboard base in front ──
  fill(6, 31, 39, 32, "T"); // top surface
  fill(40, 31, 41, 34, "S"); // side
  fill(6, 33, 39, 36, "F"); // front lip
  fill(6, 36, 39, 36, "f");
  fill(6, 37, 41, 37, "s"); // underside
  fill(6, 33, 6, 36, "T");
  for (let x = 9; x <= 31; x += 3) {
    fill(x, 33, x + 1, 33, "E");
    fill(x, 34, x + 1, 34, "e");
  }
  fill(35, 33, 36, 34, "R");
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

/** Avatar tile: charcoal background with a 45° long shadow cast down-right from the computer. */
function tile(size = 64): string {
  const ox = Math.floor((size - markW) / 2) - 3;
  const oy = Math.floor((size - markH) / 2) - 2;
  const obj = new Set(markCells.map((p) => `${p.x - padX + ox},${p.y - padY + oy}`));
  const shadow: Array<{ x: number; y: number; c: string }> = [];
  const seen = new Set<string>();
  for (const key of obj) {
    let [x, y] = key.split(",").map(Number) as [number, number];
    while (x < size && y < size) {
      x++;
      y++;
      const k = `${x},${y}`;
      if (!obj.has(k) && !seen.has(k) && x < size && y < size) {
        seen.add(k);
        shadow.push({ x, y, c: "#232323" });
      }
    }
  }
  const objCells = markCells.map((p) => ({ ...p, x: p.x - padX + ox, y: p.y - padY + oy }));
  return svg(size, size, `<rect width="${size}" height="${size}" fill="#191919"/>` + rects(shadow) + rects(objCells), 8);
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
