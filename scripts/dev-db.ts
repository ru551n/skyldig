import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import EmbeddedPostgres from "embedded-postgres";

const dataDir = fileURLToPath(new URL("../.pg-embedded/dev", import.meta.url));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "skyldig",
  password: "skyldig",
  port: 5432,
  persistent: true,
});

async function main() {
  console.log(`Starting embedded Postgres in ${dataDir} on port 5432...`);
  if (!existsSync(dataDir)) {
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase("skyldig");
  } catch {
    // database already exists, ignore
  }
  console.log(
    "Postgres is ready: postgres://skyldig:skyldig@localhost:5432/skyldig (Ctrl-C to stop)",
  );
}

async function shutdown() {
  console.log("\nStopping embedded Postgres...");
  await pg.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await main();

// keep process alive
await new Promise(() => {});
