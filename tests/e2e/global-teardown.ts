import { stopE2eDatabase } from "./db.ts";

export default async function globalTeardown() {
  await stopE2eDatabase();
}
