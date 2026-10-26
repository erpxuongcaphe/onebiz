// Generates only synthetic SQL for the dedicated CI PostgreSQL service.
import {readFileSync,writeFileSync} from 'node:fs';
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const names=['tenant','actor','store','warehouse','supplier','customer','product','substitute'];
const values=Object.fromEntries(names.map((name,i)=>[name,id(i+1)]));
const template=(file)=>{
 const src=readFileSync(file,'utf8'),start=src.indexOf('await db.exec(`')+15,end=src.indexOf('`);',start);
 if(start<15||end<0)throw Error('Fixture source changed: '+file);
 return src.slice(start,end).replace(/\$\{(\w+)\}/g,(_,name)=>{if(!values[name])throw Error(name);return values[name];});
};
const extract=(file,name)=>{
 const sql=readFileSync('supabase/migrations/'+file,'utf8'),pattern=new RegExp('create\\s+or\\s+replace\\s+function\\s+public\\.'+name+'\\s*\\(','i'),start=sql.search(pattern);
 if(start<0)throw Error(name);const tail=sql.slice(start),m=/\bas\s+(\$[a-z_]*\$)/i.exec(tail),end=tail.indexOf(m[1]+';',m.index+m[0].length);
 return tail.slice(0,end+m[1].length+1);
};
let base=template('scripts/test-fnb-warehouse-bridge.mjs');
base=base.replace('create role anon; create role authenticated;',()=>"do $$begin if not exists(select from pg_roles where rolname='anon') then create role anon;end if;if not exists(select from pg_roles where rolname='authenticated') then create role authenticated;end if;end$$;");
let pricing=extract('00363_unified_sale_pricing.sql','resolve_sale_price_00363')
 .replace('select p.id, p.sell_price into v_product','select p.id, p.sell_price, p.allow_free_sale into v_product')
 .replace("p_channel = 'fnb' and coalesce(v_unit_price, 0) <= 0","p_channel = 'fnb' and (v_unit_price is null or v_unit_price < 0 or (v_unit_price = 0 and not v_product.allow_free_sale))");
const pricingTables=`alter table customers add column price_tier_id uuid;
create table price_tiers(id uuid primary key,tenant_id uuid,is_active boolean,scope text);
create table price_tier_items(id uuid,price_tier_id uuid,product_id uuid,variant_id uuid,price numeric,min_qty numeric,created_at timestamptz default now());
create table product_variants(id uuid,tenant_id uuid,product_id uuid,is_active boolean,sell_price numeric);
create table product_platform_prices(id uuid,tenant_id uuid,product_id uuid,variant_id uuid,platform text,override_price numeric,set_at timestamptz default now());`;
const migration=name=>readFileSync('supabase/migrations/'+name,'utf8');
const sql=[base,pricingTables,pricing,migration('202610230100_fnb_purchase_sales_order_bridge.sql'),migration('202610230101_fnb_warehouse_request_line_notes.sql'),
 'alter table products add column is_fnb_stock_item boolean default false,add column barcode text,add column has_bom boolean default false;',
 migration('202610240200_warehouse_catalog_search.sql'),template('scripts/test-fnb-warehouse-order-changes.mjs'),
 extract('00299_align_purchase_order_vnd_rounding.sql','save_purchase_order_atomic'),extract('00320_uom_accounting_snapshots.sql','resolve_product_uom_factor'),extract('00320_uom_accounting_snapshots.sql','save_purchase_order_with_uom_atomic'),
 'alter table invoice_items add column unit_cost numeric,add column vat_rate numeric,add column vat_amount numeric,add column variant_id uuid;',
 extract('00331_child_sales_source_order.sql','create_child_sale_from_order'),migration('202610260100_fnb_warehouse_order_changes.sql')].join('\n');
if(!process.argv[2])throw Error('Output SQL path required');writeFileSync(process.argv[2],sql);console.log('Synthetic warehouse-change fixture generated; no database connection.');
