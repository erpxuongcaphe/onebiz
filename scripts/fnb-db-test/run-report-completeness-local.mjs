import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const fixture = path.resolve('supabase/tests/sku_financial_variants.integration.sql');
const expand = file => fs.readFileSync(file,'utf8').replace(/^\\set.*$/gm,'').replace(/^\\ir (.+)$/gm,(_,target)=>expand(path.resolve(path.dirname(file),target.trim())));
const sql = expand(fixture);
const db = new PGlite();
try { await db.exec(sql); console.log('PASS: report completeness PostgreSQL fixture'); }
catch (error) { console.error(error.message, error.where ?? ''); process.exitCode=1; }
finally { await db.close(); }
