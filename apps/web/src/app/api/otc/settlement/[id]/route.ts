import { getSettlement } from "@app/otc/server";
import { route } from "@/server/http";
import { otcContext } from "@/server/context";

export const GET = route<{ id: string }>({ auth: "required" }, async ({ params, wallet }) => getSettlement(otcContext(), params.id.slice(0, 64), wallet!));
