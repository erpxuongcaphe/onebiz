// Embedded PostgreSQL contract check, never connects to any remote database.
// CI repeats the same fixture on PostgreSQL 17, including view row locks.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.argv[2]
  ? pathToFileURL(path.resolve(process.argv[2])).href : '@electric-sql/pglite');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'onebiz-qty-'));
const generated = new Map();
for (const [script, name] of [
  ['extract-payment-posting-chain.mjs','fnb-payment-posting-chain.sql'],
  ['extract-payment-replay-chain.mjs','fnb-payment-replay-chain.sql'],
  ['extract-effective-quantity-chain.mjs','fnb-effective-quantity-chain.sql'],
]) {
  const file = path.join(temporary,name);
  execFileSync(process.execPath,[`scripts/fnb-db-test/${script}`,file]);
  generated.set(`/tmp/${name}`,file);
}
function expand(file) {
  return fs.readFileSync(file,'utf8').replace(/^\\i(r?)\s+(.+)$/gm, (_match,relative,target)=>
    expand(relative ? path.resolve(path.dirname(file),target.trim()) : generated.get(target.trim()))
  ).replace(/^\\set.*$/gm,'').replace(
    /select 'create role (\w+) nologin'\s+where not exists \(select 1 from pg_roles where rolname = '\1'\) \\gexec/g,
    (_match,name)=>`create role ${name} nologin;`
  );
}
let sql=expand(path.resolve(process.argv[3] ?? 'supabase/tests/00454_fnb_effective_unpaid_quantities.integration.sql'));
// PGlite's fixed database name differs; only replace this disposable fixture guard.
sql=sql.replace("current_database() not in ('fnb_payment_concurrency_test', 'fnb_payment_cost_test', 'fnb_payment_return_cost_test', 'fnb_full_refund_test', 'fnb_effective_qty_test')", 'false');
const db=new PGlite();
try {
  await db.exec(sql);
  console.log('PASS: effective quantities, real checkout/BOM, exact source, paid-return, split and private ACL');
} catch(e) { console.error(e.message,e.where ?? ''); process.exitCode=1; } finally {
  await db.close();
  fs.rmSync(temporary,{recursive:true,force:true});
}
