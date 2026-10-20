// Actual delivery RPCs on a disposable PostgreSQL database; no live orders.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,"0")}`;
function extract(source,name) { const start=source.search(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`,"i")); const rest=source.slice(start),m=/\bas\s+(\$[a-z_]*\$)/i.exec(rest); return rest.slice(0,rest.indexOf(m[1]+";",m.index+m[0].length)+m[1].length+1); }
try {
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema extensions;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table profiles(id uuid primary key,tenant_id uuid,is_active boolean,full_name text,can_assign boolean);
 create table branches(id uuid primary key,tenant_id uuid);
 create table branch_access(actor uuid,branch uuid);
 create function user_has_branch_access(uuid,uuid) returns boolean language sql as $$select exists(select 1 from branch_access where actor=$1 and branch=$2)$$;
 create function user_has_permission(uuid,text) returns boolean language sql as $$select coalesce(can_assign,false) from profiles where id=$1$$;
 create table customers(id uuid primary key,tenant_id uuid,name text,address text,phone text);
 create table invoices(id uuid primary key,tenant_id uuid,delivery_staff_id uuid);
 create table kitchen_orders(id uuid primary key,tenant_id uuid,branch_id uuid,invoice_id uuid,order_type text,delivery_platform text,status text,delivery_staff_id uuid,delivery_assigned_at timestamptz,delivery_completed_at timestamptz,delivery_fee numeric,created_at timestamptz default now(),updated_at timestamptz,order_number text,customer_id uuid,customer_name text,note text);
 create table audit_log(tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,old_data jsonb,new_data jsonb);
 insert into branches values('${id(10)}','${id(1)}'),('${id(11)}','${id(1)}'),('${id(20)}','${id(2)}');
 insert into profiles values('${id(3)}','${id(1)}',true,'Manager',true),('${id(4)}','${id(1)}',true,'Staff A',false),('${id(5)}','${id(1)}',true,'Staff B',false),('${id(6)}','${id(2)}',true,'Foreign',true);
 insert into branch_access values('${id(3)}','${id(10)}'),('${id(4)}','${id(10)}'),('${id(5)}','${id(10)}'),('${id(6)}','${id(20)}');
 insert into customers values('${id(30)}','${id(1)}','Customer','Original address','0900000000');
 insert into invoices values('${id(40)}','${id(1)}',null);
 insert into kitchen_orders(id,tenant_id,branch_id,invoice_id,order_type,delivery_platform,status,delivery_fee,order_number,customer_id) values
 ('${id(50)}','${id(1)}','${id(10)}','${id(40)}','delivery','direct','completed',5000,'GH-001','${id(30)}'),
 ('${id(51)}','${id(1)}','${id(10)}',null,'delivery','direct','cancelled',0,'GH-CANCEL','${id(30)}'),
 ('${id(52)}','${id(1)}','${id(10)}',null,'dine_in','direct','pending',0,'DINE-001','${id(30)}');`);
 const old=fs.readFileSync("supabase/migrations/00252_harden_fnb_kds_delivery.sql","utf8");
 await db.exec(extract(old,"assign_delivery_staff_to_order")); await db.exec(extract(old,"complete_delivery_for_order"));
 await db.exec(fs.readFileSync("supabase/migrations/202610200003_fnb_delivery_dispatch.sql","utf8"));
 const actor=async n=>db.query("select set_config('test.actor',$1,false)",[id(n)]);
 const day=(await db.query("select (now() at time zone 'Asia/Ho_Chi_Minh')::date::text d")).rows[0].d;
 const list=async(branch=10,state="all")=>(await db.query("select fnb_delivery_dispatch_20261020($1,$2,$3,0) r",[id(branch),day,state])).rows[0].r;
 const assign=async(staff,order=50)=>db.query("select assign_delivery_staff_to_order($1,$2)",[id(order),staff===null?null:id(staff)]);
 const complete=async(order=50)=>db.query("select complete_delivery_for_order($1)",[id(order)]);
 await actor(3);assert.equal((await list(10,"unassigned")).length,1);
 await assert.rejects(list(11),/DENIED/);await assert.rejects(list(20),/DENIED/);
 await assert.rejects(assign(6),/STAFF_NOT_AVAILABLE/);await assert.rejects(assign(4,51),/NOT_EDITABLE/);await assert.rejects(assign(4,52),/NOT_EDITABLE/);
 await assign(4);assert.equal((await list(10,"assigned"))[0].delivery_staff_id,id(4));
 assert.equal((await db.query("select delivery_staff_id from invoices where id=$1",[id(40)])).rows[0].delivery_staff_id,id(4));
 await db.exec("update customers set address='Changed directory address'");
 assert.equal((await list())[0].address,"Original address");
 await db.query("select fnb_delivery_destination_20261020($1,'Confirmed address','0911111111','Recipient')",[id(50)]);
 assert.equal((await list())[0].address,"Confirmed address");
 await actor(4);assert.equal((await list()).length,1);await assert.rejects(assign(5),/INSUFFICIENT_PERMISSION/);
 await actor(5);assert.equal((await list()).length,0);await assert.rejects(complete(),/INSUFFICIENT_PERMISSION/);
 await actor(3);await assign(5);await actor(4);assert.equal((await list()).length,0);
 await actor(5);await complete();const first=(await list(10,"completed"))[0].delivery_completed_at;
 await complete();assert.equal((await list())[0].delivery_completed_at,first);
 assert.equal(Number((await db.query("select count(*) n from audit_log where action='fnb_delivery_completed'")).rows[0].n),1);
 await actor(3);await assert.rejects(assign(4),/NOT_EDITABLE/);await assert.rejects(db.query("select fnb_delivery_destination_20261020($1,'Other','','Recipient')",[id(50)]),/NOT_EDITABLE/);
 await actor(6);await assert.rejects(list(),/DENIED/);
 assert.equal((await db.query("select has_function_privilege('anon','fnb_delivery_dispatch_20261020(uuid,date,text,integer)','EXECUTE') allowed")).rows[0].allowed,false);
 console.log("PASS: dispatch authorization/branch/self scope, paid-vs-delivered separation, destination snapshot, reassignment, invoice link, cancellation guards and completion replay without duplicate audit.");
} catch(e) { console.error(e.message,e.where??"");process.exitCode=1; } finally { await db.close(); }
