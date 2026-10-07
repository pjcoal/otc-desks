import { AppError } from "@app/shared";
import { route } from "@/server/http";
import { config } from "@/server/context";
import { e2eEnabled, e2eFixture } from "@/server/e2e";

/** E2E only: exposes the seeded test mint. 404 in every other mode. */
export const GET = route({}, async () => {
  if (!e2eEnabled()) throw new AppError("NOT_FOUND");
  const f = await e2eFixture(config());
  return { mint: f.mint, seller: f.seller, buyer: f.buyer };
});
