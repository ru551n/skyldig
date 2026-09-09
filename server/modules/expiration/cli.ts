import { db, pool } from "../../db/client.ts";
import { logger } from "../../logger.ts";
import { runCleanup } from "./cleanup.ts";

async function main() {
  try {
    const result = await runCleanup(db);
    console.log(JSON.stringify(result));
  } catch (error) {
    logger.error({ error }, "cleanup failed");
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
