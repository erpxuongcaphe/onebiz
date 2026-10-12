import fs from 'node:fs';
const resolver=fs.readFileSync('supabase/migrations/00320_uom_accounting_snapshots.sql','utf8').match(/create or replace function public\.resolve_product_uom_factor[\s\S]*?\n\$\$;/i)?.[0];
if(!resolver)throw new Error('Missing real product UOM resolver');
const setup=`
create table if not exists tenants(id uuid primary key);
insert into tenants select distinct tenant_id from profiles on conflict do nothing;
create table if not exists branches(id uuid primary key,tenant_id uuid);
insert into branches select distinct branch_id,tenant_id from production_orders on conflict do nothing;
create or replace function _can_read_branch_inventory_00476(uuid,uuid,uuid) returns boolean language sql as $$select user_has_branch_access($1,$3)$$;
create table uom_conversions(tenant_id uuid,product_id uuid,from_unit text,to_unit text,factor numeric,is_active boolean);
alter table products add column if not exists is_active boolean default true;
alter table products add column if not exists unit text default 'G';
alter table products add column if not exists name text default 'Fixture product';
alter table products add column if not exists code text default 'FIXTURE';
`;
fs.writeFileSync(process.argv[2],setup+'\n'+resolver+'\n'+fs.readFileSync('supabase/migrations/00511_fnb_actual_prepared_yield.sql','utf8')+'\n'+fs.readFileSync('supabase/migrations/00514_operational_uom_snapshots.sql','utf8'));
