/**
 * Boots the E2E stack: embedded Postgres (fresh database), migrations, production build, and
 * `next start` in E2E_LITESVM mode. Used as Playwright's webServer command.
 */
import { execSync, spawn } from "node:child_process";
import { join } from "node:path";
import { startEmbeddedPostgres } from "../../../scripts/embedded-postgres";
import { E2E_ENV } from "./env";

const root = join(import.meta.dirname, "..", "..", "..");
const { url } = await startEmbeddedPostgres({ port: 54331, dir: join(root, ".embedded-pg", "e2e"), database: `otc_e2e_${Date.now()}` });
const env = { ...process.env, ...E2E_ENV, DATABASE_URL: url };
execSync("npx prisma migrate deploy", { cwd: join(root, "packages/database"), env, stdio: "inherit" });
if (!process.env.E2E_SKIP_BUILD) execSync("npx next build", { cwd: join(root, "apps/web"), env, stdio: "inherit" });
const child = spawn("npx", ["next", "start", "-p", E2E_ENV.PORT], { cwd: join(root, "apps/web"), env, stdio: "inherit" });
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));
