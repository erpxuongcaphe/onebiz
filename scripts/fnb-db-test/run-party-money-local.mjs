import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
function expand(file) {
  return fs.readFileSync(file,'utf8').replace(/^\\ir\s+(.+)$/gm,(_,target)=>expand(path.resolve(path.dirname(file),target.trim()))).replace(/^\\set.*$/gm,'');
}
const {PGlite}=await import(pathToFileURL(path.resolve(process.argv[2])).href);
const db=new PGlite();
try {
  await db.exec(expand('supabase/tests/00552_party_money.setup.sql'));
  await db.exec(expand('supabase/tests/00553_party_money.integration.sql'));
  console.log('PASS: real payment/allocation/amendment RPCs on disposable in-memory PostgreSQL');
} catch(error) {
  console.error(JSON.stringify({message:error.message,code:error.code,detail:error.detail,where:error.where,position:error.position}));
  process.exitCode=1;
} finally {await db.close();}
