import fs from 'node:fs';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import path from 'node:path';
const {PGlite}=await import(pathToFileURL(path.resolve(process.argv[2])).href);const db=new PGlite();const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
try{
await db.exec(`create schema auth;
create function auth.uid() returns uuid language sql as $$ select '${id(1)}'::uuid $$;
create function _can_read_branch_inventory_00476(uuid,uuid,uuid) returns boolean language sql as $$ select true $$;
create function _fnb_branch_cost_tracking_enabled_00390(uuid,uuid) returns boolean language sql as $$ select $2='${id(2)}'::uuid $$;
create table fnb_branch_product_cost_events(id uuid,tenant_id uuid,branch_id uuid,product_id uuid,created_at timestamptz,direction text,source_type text,source_reference_type text,quantity numeric,total_cost numeric,source_stock_movement_id uuid);
create table stock_movements(id uuid,tenant_id uuid,branch_id uuid,product_id uuid,created_at timestamptz,type text,reference_type text,quantity numeric,unit_cost numeric,unit_price numeric);
insert into fnb_branch_product_cost_events(tenant_id,branch_id,product_id,created_at,direction,source_type,source_reference_type,quantity,total_cost) values
('${id(1)}','${id(2)}','${id(4)}','2026-10-01','in','production_complete','production_complete',10,1000),
('${id(1)}','${id(2)}','${id(4)}','2026-10-02','out','production_complete','production_correction',10,1000),
('${id(1)}','${id(2)}','${id(4)}','2026-10-02','in','production_complete','production_correction',10,100),
('${id(1)}','${id(2)}','${id(4)}','2026-10-03','out','invoice','bom_consume',4,40);
insert into stock_movements(tenant_id,branch_id,product_id,created_at,type,reference_type,quantity,unit_cost) values
('${id(1)}','${id(3)}','${id(4)}','2026-10-01','in','purchase_entry',10,2),
('${id(1)}','${id(3)}','${id(4)}','2026-10-03','out','invoice',3,2);`);
await db.exec(fs.readFileSync('supabase/migrations/00543_fnb_production_value_restatement.sql','utf8'));
const totals=async(from,to,branch=2)=>(await db.query(`select coalesce(sum(amount) filter(where direction='in'),0)::text iv,coalesce(sum(amount) filter(where direction='out'),0)::text ov,sum(case direction when 'in' then quantity else -quantity end)::text qty from _inventory_value_timeline_00540($1,$2,$3,$4)`,[from,to,id(branch),id(1)])).rows[0];
assert.deepEqual(await totals('2026-10-01','2026-10-04'),{iv:'100',ov:'40',qty:'6'},'corrected receipt cost, real issue cost and physical net quantity');
assert.deepEqual(await totals('2026-10-01','2026-10-02'),{iv:'1000',ov:'0',qty:'10'},'earlier period stays historically unchanged');
assert.deepEqual(await totals('2026-10-02','2026-10-03'),{iv:'-900',ov:'0',qty:'0'},'later cost-only adjustment has zero physical quantity');
assert.deepEqual(await totals('2026-10-01','2026-10-04',3),{iv:'20',ov:'6',qty:'7'},'untracked retail valuation unchanged');
console.log('PASS: production cost restatement, correct incoming/outgoing averages, historical cutoff, zero correction quantity, unchanged retail');
}finally{await db.close()}
