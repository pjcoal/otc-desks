import { route } from "@/server/http";
import { destroySession } from "@/server/session";

export const POST = route({ auth: "optional" }, async () => {
  await destroySession();
  return { ok: true };
});
