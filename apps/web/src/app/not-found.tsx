import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-16">
      <h1 className="title-display text-[28px]">Nothing here</h1>
      <p className="mt-3 text-muted">This page doesn&apos;t exist. If you followed a deal link, it may be private to another wallet.</p>
      <Link href="/explore" className="mt-6 inline-block text-glacier hover:underline">Explore markets</Link>
    </div>
  );
}
