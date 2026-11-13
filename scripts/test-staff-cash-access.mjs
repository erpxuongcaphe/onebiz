import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
process.env.ONEBIZ_STAFF_CASH_TEST = "1";
process.argv[2] =
  process.env.ONEBIZ_PGLITE_MODULE ?? require.resolve("@electric-sql/pglite");
await import("./fnb-db-test/run-party-money-local.mjs");
