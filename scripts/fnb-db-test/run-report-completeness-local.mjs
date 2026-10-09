import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const fixture = path.resolve('supabase/tests/00461_report_stock_and_sku_snapshots.integration.sql');
const sql = fs.readFileSync(fixture,'utf8').replace(/^\\set.*$/gm,'').replace(/^\\ir (.+)$/gm,(_,file)=>fs.readFileSync(path.resolve(path.dirname(fixture),file.trim()),'utf8'));
const db = new PGlite();
try { await db.exec(sql); console.log('PASS: report completeness PostgreSQL fixture'); }
catch (error) { console.error(error.message, error.where ?? ''); process.exitCode=1; }
finally { await db.close(); }
