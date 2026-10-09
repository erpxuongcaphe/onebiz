import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const { PGlite } = await import(process.argv[2] ? pathToFileURL(path.resolve(process.argv[2])).href : '@electric-sql/pglite');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'onebiz-cancel-request-'));
const generated=path.join(temporary,'chain.sql');
const voidCore=path.join(temporary,'void.sql');
execFileSync(process.execPath,['scripts/fnb-db-test/extract-void-core.mjs',voidCore]);
execFileSync(process.execPath,['scripts/fnb-db-test/extract-unpaid-cancel.mjs',generated]);
function expand(file) {
 return fs.readFileSync(file,'utf8').replace(/^\\i(r?)\s+(.+)$/gm,(_m,relative,target)=>expand(relative?path.resolve(path.dirname(file),target.trim()):(target.trim()==='/tmp/fnb-void-core.sql'?voidCore:generated))).replace(/^\\set.*$/gm,'');
}
const db=new PGlite();
try { await db.exec(expand(path.resolve('supabase/tests/00462_fnb_cancel_request_review.integration.sql'))); console.log('PASS: partial cancellation, quantities, toppings, net discount, OTP exact request, rejection/replay, stale data, branch and retry'); }
catch(e) { console.error(e.message, e.detail ?? '', e.where ?? ''); process.exitCode=1; }
finally { await db.close(); }

const refundDb=new PGlite();
try { await refundDb.exec(expand(path.resolve('supabase/tests/00456_fnb_void_methods.integration.sql'))); console.log('PASS: original mixed receipt methods, net drawer, repeat and partial-return/missing-receipt rollback'); }
catch(e) { console.error(e.message,e.where ?? ''); process.exitCode=1; } finally { await refundDb.close(); fs.rmSync(temporary,{recursive:true,force:true}); }
