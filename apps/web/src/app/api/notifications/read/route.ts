import { z } from "zod";
import { getDb } from "@app/database";
import { body, route } from "@/server/http";

export const POST = route({ auth: "required" }, async ({ req, wallet }) => {
  const { ids } = await body(req, z.object({ ids: z.array(z.string().max(64)).max(100).optional() }));
  const res = await getDb().notification.updateMany({ where: { wallet: wallet!, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
  return { updated: res.count };
});
