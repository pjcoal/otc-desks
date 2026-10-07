import { verifyReceipt } from "@app/otc/server";
import { route } from "@/server/http";
import { otcContext } from "@/server/context";
import { zSignature } from "@/server/schemas";

/** GET /api/receipts/:signature — settlement receipt reconstructed and verified from chain data. */
export const GET = route<{ signature: string }>({}, async ({ params }) => verifyReceipt(otcContext(), zSignature.parse(params.signature)));
