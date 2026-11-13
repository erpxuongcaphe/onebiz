// Uses the existing synthetic stock/cost fixture and complete public payment chain.
process.env.ONEBIZ_STAFF_CHECKOUT_TEST = "1";
await import("./fnb-db-test/run-fnb-stock-posting-local.mjs");
