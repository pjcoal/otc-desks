"use client";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl py-16">
      <h1 className="title-display text-[40px]">This page failed to load</h1>
      <p className="mt-3 text-muted">{error.message || "An unexpected error occurred."}{error.digest ? ` (ref ${error.digest})` : ""}</p>
      <button onClick={reset} className="mt-6 rounded-[var(--radius-control)] border border-line-strong px-4 py-2 hover:bg-hover">Try again</button>
    </div>
  );
}
