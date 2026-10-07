import { route } from "@/server/http";
import { registry } from "@/server/context";
import { zAddress } from "@/server/schemas";

export const GET = route<{ mint: string }>({}, async ({ params }) => ({ holders: await registry().topHolders(zAddress.parse(params.mint)) }));
