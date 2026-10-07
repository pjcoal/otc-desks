import type { ReactNode } from "react";
import { publicConfig } from "@/server/context";

/**
 * Configurable legal page shell. The text below is a PLACEHOLDER template written to be accurate
 * about how the software works; it is not legal advice and must be reviewed by counsel before launch.
 */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  const c = publicConfig();
  return (
    <article className="memo mx-auto max-w-[76ch] space-y-4 bg-ink px-6 py-6 text-text bevel-in sm:px-10 [&_h2]:mt-8 [&_h2]:font-medium [&_h2]:uppercase [&_li]:ml-5 [&_li]:list-[square] [&_p]:text-muted [&_li]:text-muted">
      <h1 className="text-[20px] font-medium">{title}</h1>
      <p className="text-[13px] text-faint">Last updated {updated}. Template provided by {c.appName} operators; not legal advice.</p>
      {children}
    </article>
  );
}
