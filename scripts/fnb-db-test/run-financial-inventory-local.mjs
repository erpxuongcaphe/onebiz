import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

if (!process.argv[2]) throw new Error("Pass the isolated PGlite module path.");
const { PGlite } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
mkdirSync(".tmp", { recursive: true });
const output = process.argv[2];
process.argv[2] = ".tmp/financial-inventory-baseline.sql";
await import("./extract-financial-inventory-baseline.mjs");
process.argv[2] = output;

function expand(file) {
  return readFileSync(file, "utf8")
    .replace(/^\\ir (.+)$/gm, (_, target) => expand(path.resolve(path.dirname(file), target.trim())))
    .replace(/^\\set.*$/gm, "")
    .replace(/select 'create role[\s\S]*?\\gexec/g, "");
}

const db = new PGlite();
try {
  await db.exec("create role anon; create role authenticated;");
  await db.exec(expand("supabase/tests/202610220001_financial_inventory_read.integration.sql"));
  const before = (await db.query("select public.test_business_hash() hash")).rows[0];
  const migration = readFileSync("supabase/migrations/202610220001_financial_report_inventory_read.sql", "utf8");
  await assert.rejects(db.exec(migration), /already exists/);
  await db.exec("rollback");
  assert.deepEqual((await db.query("select public.test_business_hash() hash")).rows[0], before);

  // Keep the patched report but remove its helpers to exercise the source guard.
  await db.exec(`
    drop function public._financial_inventory_summary_20261022(timestamptz,timestamptz,uuid,uuid);
    drop function public._financial_inventory_timeline_20261022(timestamptz,timestamptz,uuid,uuid);
  `);
  await assert.rejects(db.exec(migration), /FINANCIAL_INVENTORY_PATCH_SOURCE_CHANGED/);
  await db.exec("rollback");
  assert.equal((await db.query(`select to_regprocedure('public._financial_inventory_summary_20261022(timestamptz,timestamptz,uuid,uuid)') is null missing`)).rows[0].missing, true);
  assert.deepEqual((await db.query("select public.test_business_hash() hash")).rows[0], before);
  console.log("PASS: public synthetic financial fixture, report JSON equivalence, unchanged business data/metadata/shared functions, private helper ACL, replay and source-change rollback.");
} finally {
  await db.close();
}

