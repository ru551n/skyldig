import { inject } from "vitest";

process.env.DATABASE_URL = inject("databaseUrl");
process.env.NODE_ENV ??= "test";
