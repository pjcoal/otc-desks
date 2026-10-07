/** Hand-drawn 12×12 bitmap icons rendered as crisp SVG rects (no anti-aliasing). */
const PALETTE: Record<string, string> = {
  k: "#1a1915",
  w: "#fbfaf5",
  y: "#e8c25a",
  b: "#1c4e8c",
  r: "#b03024",
  p: "#9b6b3c",
  g: "#2e7d4f",
  s: "#8e897d",
};

const ICONS = {
  explore: ["............", "..kkkk......", ".kwwwwk.....", "kwbwwwwk....", "kwbwwwwk....", "kwwwwwwk....", "kwwwwwwk....", ".kwwwwk.....", "..kkkkkk....", "......kkk...", ".......kkk..", "........kk.."],
  ticket: ["..kkkkkkk...", "..kwwwwwkk..", "..kwbbbwwkk.", "..kwwwwwwwk.", "..kwbbbbbwk.", "..kwwwwwwwk.", "..kwbbbbbwk.", "..kwwwwwwwk.", "..kwrrrwwwk.", "..kwrrrwwwk.", "..kwwwwwwwk.", "..kkkkkkkkk."],
  rocket: [".....kk.....", "....kwwk....", "....kwwk....", "...kwbbwk...", "...kwbbwk...", "...kwwwwk...", "..kkwwwwkk..", ".krkwwwwkrk.", ".kkkwwwwkkk.", "....kyyk....", "....kryk....", ".....kk....."],
  briefcase: ["............", "....kkkk....", "....k..k....", ".kkkkkkkkkk.", "kppppppppppk", "kppppppppppk", "kkkkkyykkkkk", "kppppyyppppk", "kppppppppppk", "kppppppppppk", "kkkkkkkkkkkk", "............"],
  folder: ["............", ".kkkk.......", "kyyyyk......", "kyyyykkkkkk.", "kyyyyyyyyyyk", "kykkkkkkkkkk", "kyywwwwwwwyk", "kyywwwwwwwyk", "kyyyyyyyyyyk", "kyyyyyyyyyyk", "kkkkkkkkkkkk", "............"],
  help: [".kkkkkkkkk..", ".kbbbbbbbkk.", ".kbbwwwbbkk.", ".kbwbbbwbkk.", ".kbbbbwbbkk.", ".kbbbwbbbkk.", ".kbbbwbbbkk.", ".kbbbbbbbkk.", ".kbbbwbbbkk.", ".kkkkkkkkkk.", "..kwwwwwwwk.", "..kkkkkkkkk."],
  gear: ["....kkkk....", "..kkssssk...", ".kssssssskk.", ".ksskkkkssk.", "kssk....kssk", "ksk......ksk", "ksk......ksk", "kssk....kssk", ".ksskkkkssk.", ".kssssssskk.", "..kkssssk...", "....kkkk...."],
  legs: ["............", "yyyy....bbbb", "...y....b...", "...yy..bb...", "....y..b....", "....yyyy....", ".....kk.....", ".....kk.....", ".....kk.....", ".....kk.....", ".....kk.....", "............"],
} as const;

export type PixelIconName = keyof typeof ICONS;

export function PixelIcon({ name, size = 24, className }: { name: PixelIconName; size?: number; className?: string }) {
  const rows = ICONS[name];
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" className={className} aria-hidden>
      {rows.flatMap((row, y) =>
        row.split("").map((c, x) => (c === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={PALETTE[c]} />)),
      )}
    </svg>
  );
}
