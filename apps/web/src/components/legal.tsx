import type { ReactNode } from "react";
import { publicConfig } from "@/server/context";

/**
 * Configurable legal page shell. The text below is a PLACEHOLDER template written to be accurate
 * about how the software works; it is not legal advice and must be reviewed by counsel before launch.
 */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  const c = publicConfig();
  return (
    <article className="mx-auto max-w-[68ch] space-y-5 pb-8 text-[15px] leading-relaxed [&_h2]:mt-8 [&_h2]:text-[18px] [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:text-muted [&_li]:text-muted">
      <h1 className="title-display text-[44px] leading-none">{title}</h1>
      <p className="text-[13px] text-faint">Last updated {updated}. Template provided by {c.appName} operators; not legal advice.</p>
      {children}
    </article>
  );
}
