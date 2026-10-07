import { getDb } from "@app/database";
import { route } from "@/server/http";

export const GET = route({ auth: "required" }, async ({ wallet }) => {
  const db = getDb();
  const [items, unread] = await Promise.all([db.notification.findMany({ where: { wallet: wallet! }, orderBy: { createdAt: "desc" }, take: 50 }), db.notification.count({ where: { wallet: wallet!, readAt: null } })]);
  return { items, unread };
});
