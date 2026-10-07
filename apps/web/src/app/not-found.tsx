import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-12">
      <h1 className="title-display text-[30px]">Error 404: wrong desk</h1>
      <p className="mt-3 text-muted">Nobody works at this address. If you followed a deal link, it may be a private offer for a different wallet.</p>
      <Link href="/explore" className={buttonClass({ variant: "primary", className: "mt-6" })}>
        Back to Explore
      </Link>
    </div>
  );
}
