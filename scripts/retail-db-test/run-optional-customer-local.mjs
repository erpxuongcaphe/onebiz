import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
// In-memory PostgreSQL only. No database URL or production credentials accepted.
const { PGlite } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const source = '';
const db = new PGlite();
const migration = readFileSync(source+'supabase/migrations/00572_retail_optional_customer_record.sql','utf8');
try {
 await db.exec(`
 create role anon; create role authenticated; create role service_role;
 create table public.products(id uuid,tenant_id uuid,name text,unit text,sell_price numeric,vat_rate numeric,category_id uuid,is_active boolean,allow_sale boolean);
 create table public.customers(id uuid,tenant_id uuid,name text,group_id uuid,price_tier_id uuid,loyalty_points integer,is_active boolean);
 create table public.customer_groups(id uuid,tenant_id uuid,discount_percent numeric);
 create function public.user_has_permission(uuid,text) returns boolean language sql as $$select false$$;
 create function public.verify_otp_authorization(uuid,text,uuid,uuid) returns uuid language plpgsql as $$begin raise exception 'OTP_REQUIRED'; end$$;
 insert into products values ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','Keo dinh chuot','Cai',12000,0,null,true,true);
 insert into customers values ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','Customer',null,null,0,true);
 `);
 const original = readFileSync(source+'supabase/migrations/00253_harden_retail_pos_pricing.sql','utf8');
 const start=original.indexOf('create or replace function public.pos_prepare_retail_checkout(');
 const end=original.indexOf('$$;',start)+3;
 await db.exec(original.slice(start,end).replace("      and p.status = 'active'",''));
 await db.exec(readFileSync(source+'supabase/migrations/00297_fix_pos_unassigned_variant_record.sql','utf8'));
 const t='00000000-0000-0000-0000-000000000001', b='00000000-0000-0000-0000-000000000002', p='00000000-0000-0000-0000-000000000003';
 async function call({customer=null,quantity=2,price=12000,discount=0,shipping=0,vat=0}={}) {
   return db.query(`select public.pos_prepare_retail_checkout($1::uuid,null,$2::uuid,$3::uuid,$4::jsonb,null,0,null,null,0,null,$5,$6) as result`,[t,b,customer,JSON.stringify([{productId:p,quantity,unitPrice:price,discount}]),shipping,vat]);
 }
 await assert.rejects(call(), /record "v_customer" is not assigned yet/);
 console.log('PASS reproduced screenshot: real Retail pricing function throws unassigned v_customer');
 const before = await db.query('select count(*)::int n from products');
 await db.exec(migration);
 const result=(await call()).rows[0].result;
 assert.equal(result.total,24000); assert.equal(result.customer_name,'Khách lẻ');
 assert.equal((await call({shipping:10000,vat:8})).rows[0].result.total,36720);
 assert.equal((await call({customer:'00000000-0000-0000-0000-000000000004'})).rows[0].result.total,24000);
 await assert.rejects(call({customer:'00000000-0000-0000-0000-000000000099'}),/POS_CUSTOMER_INVALID/);
 await assert.rejects(call({quantity:0}),/POS_ITEM_VALUE_INVALID/);
 await assert.rejects(call({price:10000}),/POS_PRICE_CHANGED/);
 await assert.rejects(call({discount:50000}),/POS_LINE_DISCOUNT_INVALID/);
 await assert.rejects(call({shipping:-1}),/POS_SHIPPING_FEE_INVALID/);
 await assert.rejects(call({vat:20}),/POS_ORDER_VAT_INVALID/);
 await db.exec(migration);
 assert.equal((await call()).rows[0].result.total,24000);
 assert.deepEqual((await db.query('select count(*)::int n from products')).rows,before.rows);
 console.log('PASS 10 checks: walk-in 24000, named customer, shipping/VAT, invalid customer, quantity, price and discount guards, migration replay, unchanged fixture data');
} finally { await db.close(); }
