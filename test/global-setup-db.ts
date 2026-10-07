/**
 * Integration-test database: a real PostgreSQL (embedded-postgres binaries) on a dedicated port,
 * a fresh database per run, migrated with `prisma migrate deploy`. Set TEST_DATABASE_URL to use an
 * existing server instead (e.g. in CI with a Postgres service container).
 */
import { execSync } from "node:child_process";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { startEmbeddedPostgres } from "../scripts/embedded-postgres";

import "./vitest.d.ts";

export default async function setup(project: TestProject) {
  let url = process.env.TEST_DATABASE_URL;
  let stop: (() => Promise<void>) | undefined;
  if (!url) {
    const port = Number(process.env.TEST_PG_PORT ?? 54330);
    const db = `otc_test_${Date.now()}`;
    const { pg, url: u } = await startEmbeddedPostgres({ port, dir: join(process.cwd(), ".embedded-pg", `test-${port}`), database: db });
    url = u;
    stop = async () => {
      try {
        await pg.dropDatabase(db);
      } finally {
        await pg.stop();
      }
    };
  }
  execSync("npx prisma migrate deploy", { cwd: join(process.cwd(), "packages/database"), env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  project.provide("databaseUrl", url);
  return async () => {
    await stop?.();
  };
}
