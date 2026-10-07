import { AppError } from "@app/shared";
import { route } from "@/server/http";
import { registry } from "@/server/context";
import { zAddress } from "@/server/schemas";

/** GET /api/tokens/:mint — live market snapshot (venue auto-detected), metadata and Token-2022 safety report. */
export const GET = route<{ mint: string }>({}, async ({ params }) => {
  const mint = zAddress.safeParse(params.mint);
  if (!mint.success) throw new AppError("VALIDATION", "Invalid mint address.");
  return registry().tokenDetail(mint.data);
});
