/** Display helpers that are safe on both server and client. */
export function shortAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 1) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

export function isBase58PublicKey(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

export function relativeTime(date: Date | string | number, now: number = Date.now()): string {
  const t = new Date(date).getTime();
  const diff = Math.round((t - now) / 1000);
  const abs = Math.abs(diff);
  const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [86400 * 30, "day"],
    [86400 * 365, "month"],
  ];
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });
  let divisor = 1;
  for (const [limit, unit] of units) {
    if (abs < limit) return rtf.format(Math.round(diff / divisor), unit);
    divisor = limit;
  }
  return rtf.format(Math.round(diff / (86400 * 365)), "year");
}
