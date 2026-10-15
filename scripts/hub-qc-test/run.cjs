const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require(
  process.env.HUB_PGLITE_DIR || "@electric-sql/pglite",
);
const root = path.resolve(__dirname, "../..");
const migrations = [
  "00501_operations_hub.sql",
  "00502_operations_evidence.sql",
  "00503_operations_scheduler.sql",
  "00504_operations_period_adjustments.sql",
  "00505_operations_todo_paging.sql",
  "00506_operations_result_adjustments.sql",
  "00507_operations_measurements.sql",
  "00508_operations_mkt_links.sql",
  "00509_operations_filters_access.sql",
  "00514_operations_standard_proposals.sql",
  "00527_operations_quality_foundation.sql",
  "00528_operations_quality_reads.sql",
];
async function bootstrap(db) {
  await db.exec(fs.readFileSync(path.join(__dirname, "bootstrap.sql"), "utf8"));
  for (const migration of [
    ...migrations,
    "00529_operations_quality_evidence.sql",
    "00530_operations_quality_accounting_and_reports.sql",
    "00531_operations_quality_access.sql",
  ]) {
    try {
      await db.exec(
        fs.readFileSync(
          path.join(root, "supabase/migrations", migration),
          "utf8",
        ),
      );
    } catch (e) {
      throw new Error(`${migration}: ${e.message}`, { cause: e });
    }
  }
}
module.exports = { bootstrap };
if (require.main === module)
  (async () => {
    const db = new PGlite();
    try {
      await bootstrap(db);
      console.log(
        "PASS real Hub migration chain compiled on isolated PostgreSQL",
      );
      await require("./acceptance.cjs")(db);
      await require("./advanced.cjs")(db);
      await db.exec(fs.readFileSync(path.join(root, "Hub/PREFLIGHT_QC_READ_ONLY.sql"), "utf8"));
      console.log("PASS read-only release preflight compiles on isolated PostgreSQL");
      const cases = path.join(__dirname, "cases.sql");
      if (fs.existsSync(cases)) {
        const results = await db.exec(fs.readFileSync(cases, "utf8"));
        console.log(
          JSON.stringify(
            results.filter((r) => r.rows?.length).map((r) => r.rows),
          ),
        );
      }
    } catch (e) {
      console.error(e.stack);
      const err = e.cause ?? e;
      console.error({
        message: err.message,
        position: err.position,
        where: err.where,
        detail: err.detail,
        internalQuery: err.internalQuery,
      });
      process.exitCode = 1;
    } finally {
      await db.close();
    }
  })();
