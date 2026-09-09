import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import EmbeddedPostgres from "embedded-postgres";
import type { TestProject } from "vitest/node";

const dataDir = fileURLToPath(new URL("../../.pg-embedded/test", import.meta.url));

let pg: EmbeddedPostgres | undefined;

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const existingUrl = process.env.TEST_DATABASE_URL;
  if (existingUrl) {
    project.provide("databaseUrl", existingUrl);
    process.env.DATABASE_URL = existingUrl;
    return;
  }

  const port = 55432;
  pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "skyldig_test",
    password: "skyldig_test",
    port,
    persistent: false,
  });

  if (!existsSync(dataDir)) {
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase("skyldig_test");
  } catch {
    // already exists
  }

  const databaseUrl = `postgres://skyldig_test:skyldig_test@localhost:${port}/skyldig_test`;

  process.env.DATABASE_URL = databaseUrl;
  process.env.NODE_ENV = "test";
  const { runMigrations } = await import("../../server/db/migrate.ts");
  await runMigrations(databaseUrl);

  project.provide("databaseUrl", databaseUrl);

  return async () => {
    await pg?.stop();
  };
}
