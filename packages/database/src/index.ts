import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

export * from "./generated/client";
export { Prisma } from "./generated/client";
export * from "./convert";

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

export function createPrismaClient(url: string = process.env.DATABASE_URL ?? ""): PrismaClient {
  const adapter = new PrismaPg({ connectionString: url, max: Number(process.env.DATABASE_POOL_SIZE ?? 10) });
  return new PrismaClient({ adapter });
}

/** Process-wide singleton (survives Next.js dev hot reloads). */
export function getDb(): PrismaClient {
  globalForPrisma.__prisma ??= createPrismaClient();
  return globalForPrisma.__prisma;
}

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
