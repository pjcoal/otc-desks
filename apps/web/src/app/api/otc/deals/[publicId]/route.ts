import { getDeal } from "@app/otc/server";
import { route } from "@/server/http";
import { otcContext } from "@/server/context";

/** GET /api/otc/deals/:publicId — knowing the link reveals nothing to wallets that are not party to the deal. */
export const GET = route<{ publicId: string }>({ auth: "optional" }, async ({ params, wallet }) => getDeal(otcContext(), params.publicId.slice(0, 64), wallet));
