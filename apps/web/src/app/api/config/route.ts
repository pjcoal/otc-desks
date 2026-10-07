import { route } from "@/server/http";
import { publicConfig } from "@/server/context";

export const GET = route({}, async () => publicConfig());
