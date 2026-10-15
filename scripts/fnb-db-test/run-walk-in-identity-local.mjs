import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(path.resolve(process.argv[2])).href);
function expand(file) {
  return fs.readFileSync(file,'utf8').replace(/^\\ir\s+(.+)$/gm,(_,target)=>expand(path.resolve(path.dirname(file),target.trim()))).replace(/^\\set.*$/gm,'');
}
const db=new PGlite();
try {
  await db.exec(expand('supabase/tests/00537_walk_in_customer_identity.integration.sql'));
  console.log('PASS: legacy adoption, next group code, UUID/debt/document preservation, replay, old-client duplicate guard, tenant/permission and direct identity guards, new singleton.');
} finally { await db.close(); }
