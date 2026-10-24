// Disposable embedded PostgreSQL, no connection to production. CI uses real pgcrypto.
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);const db=new PGlite();
function expand(file){return fs.readFileSync(file,'utf8').replace(/^\\ir (.+)$/gm,(_,name)=>expand(path.resolve(path.dirname(file),name.trim()))).replace(/^\\set.*$/gm,'');}
let sql=expand('supabase/tests/fnb_print_recovery.integration.sql');
sql=sql.replace('create extension pgcrypto with schema extensions;',()=>`create function extensions.gen_random_bytes(n integer) returns bytea language sql volatile as $$select substring(decode(md5(random()::text)||md5(random()::text),'hex') from 1 for n)$$;
create function extensions.digest(v bytea, algorithm text) returns bytea language sql immutable as $$select decode(md5(v)||md5(v),'hex')$$;
create function extensions.digest(v text, algorithm text) returns bytea language sql immutable as $$select extensions.digest(convert_to(v,'UTF8'),algorithm)$$;`);
try{await db.exec(sql);console.log('PASS disposable PostgreSQL print baseline + recovery scenarios (local digest stub; real pgcrypto in CI)');}catch(error){console.error(error.message, error.where ?? '');process.exitCode=1;}finally{await db.close();}
