import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // Migrations need a direct (non-pooled) connection when the provider offers one (Neon, Supabase).
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? "postgresql://otc:otc@localhost:5432/otc",
  },
});
