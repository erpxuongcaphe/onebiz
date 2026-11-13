process.env.ONEBIZ_STAFF_MERGE_TEST = "1";
if (process.env.ONEBIZ_PGLITE_MODULE)
  process.argv[2] = process.env.ONEBIZ_PGLITE_MODULE;
await import("./fnb-db-test/run-multiple-bills-local.mjs");
