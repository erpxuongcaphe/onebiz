// Embedded PostgreSQL only, no remote connections.
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
const {PGlite}=await import(process.argv[2]?pathToFileURL(path.resolve(process.argv[2])).href:'@electric-sql/pglite');
const expand=file=>fs.readFileSync(file,'utf8').replace(/^\\ir (.+)$/gm,(_,target)=>expand(path.resolve(path.dirname(file),target.trim())));
const db=new PGlite();
try{await db.exec(expand(path.resolve('supabase/tests/fnb_buyer_employee_lookup.integration.sql')));console.log('PASS: scoped contact/employee search, Vietnamese normalization, linked identity, ACLs, limits, activity and no read-side writes');}
catch(error){console.error(error.message,error.where??'');process.exitCode=1;}finally{await db.close();}
