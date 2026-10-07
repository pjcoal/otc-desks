/** Desk 404 brand images (pixel-exact SVGs from scripts/generate-brand.ts). */
export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return <img src="/brand/desk404-mark.svg" alt="" width={size} height={size} className={className} style={{ imageRendering: "pixelated" }} />;
}

export function LogoLockup({ height = 48, dark = false, className }: { height?: number; dark?: boolean; className?: string }) {
  return (
    <img src={dark ? "/brand/desk404-logo-dark.svg" : "/brand/desk404-logo.svg"} alt="Desk 404" height={height} style={{ height, width: "auto", imageRendering: "pixelated" }} className={className} />
  );
}
