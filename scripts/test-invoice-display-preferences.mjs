// Local embedded PostgreSQL; never connects to production.
import fs from "node:fs";import path from "node:path";import {pathToFileURL} from "node:url";
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);const db=new PGlite();
const file="supabase/tests/202610240001_invoice_display_account_preferences.integration.sql";
const sql=fs.readFileSync(file,"utf8").replace(/^\\ir (.+)$/gm,(_,name)=>fs.readFileSync(path.resolve(path.dirname(file),name.trim()),"utf8"));
try{await db.exec(sql);console.log("PASS: own-account guards, init race, atomic patch merge, invalid payloads, inactive/anon/direct access, invoices unchanged");}finally{await db.close();}
