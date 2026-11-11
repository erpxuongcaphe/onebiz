import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
process.env.ONEBIZ_STAFF_ADJUSTMENT_POSTING_TEST = "1";
process.argv[2] =
  process.env.ONEBIZ_PGLITE_MODULE ?? require.resolve("@electric-sql/pglite");
await import("./retail-db-test/run-stock-target-local.mjs");
