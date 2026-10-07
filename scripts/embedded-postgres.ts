/**
 * Local Postgres without Docker. Starts a real PostgreSQL server from the `embedded-postgres`
 * package binaries, persisting to ./.embedded-pg. Used for local development and the integration
 * test suite. Production uses a managed Postgres.
 *
 *   npm run db:embedded            # foreground, Ctrl-C to stop
 *   DATABASE_URL=postgresql://otc:otc@localhost:54329/otc
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const port = Number(process.env.EMBEDDED_PG_PORT ?? 54329);
const databaseDir = join(process.cwd(), ".embedded-pg", String(port));

export async function startEmbeddedPostgres(opts: { port?: number; dir?: string; database?: string } = {}) {
  const p = opts.port ?? port;
  const dir = opts.dir ?? databaseDir;
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: "otc", password: "otc", port: p, persistent: true, onLog: () => {} });
  if (!existsSync(join(dir, "PG_VERSION"))) await pg.initialise();
  await pg.start();
  const db = opts.database ?? "otc";
  try {
    await pg.createDatabase(db);
  } catch {
    // already exists
  }
  return { pg, url: `postgresql://otc:otc@localhost:${p}/${db}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { pg, url } = await startEmbeddedPostgres();
  console.log(`Embedded Postgres ready: ${url}`);
  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
