import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite }=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
function extract(s,name){const start=s.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`,'i'));if(start<0)throw Error(name);const t=s.slice(start),m=/\bas\s+(\$[a-z_]*\$)/i.exec(t);const end=t.indexOf(m[1]+';',m.index+m[0].length);return t.slice(0,end+m[1].length+1);}
await db.exec(`create role anon; create role authenticated; create schema auth; create schema extensions;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table profiles(id uuid primary key,tenant_id uuid,full_name text,is_active boolean default true,branch_id uuid,role text);
 create table branches(id uuid primary key,tenant_id uuid,name text);
 create table grants(actor uuid,permission text); create table branch_grants(actor uuid,branch uuid);
 create function user_has_permission(uuid,text) returns boolean language sql stable as $$select exists(select 1 from grants where actor=$1 and permission=$2)$$;
 create function user_has_branch_access(uuid,uuid) returns boolean language sql stable as $$select exists(select 1 from branch_grants where actor=$1 and branch=$2)$$;
 create table products(id uuid primary key,tenant_id uuid,code text,name text);
 create table product_variants(id uuid primary key,tenant_id uuid,product_id uuid,name text);
 create table customers(id uuid primary key,tenant_id uuid,code text,name text);
 create table suppliers(id uuid primary key,tenant_id uuid,code text,name text);
 create table invoices(id uuid primary key,tenant_id uuid,branch_id uuid,code text,deleted_at timestamptz);
 create table kitchen_orders(id uuid primary key,tenant_id uuid,branch_id uuid,invoice_id uuid,status text,idempotency_key text);
 create table kitchen_order_items(kitchen_order_id uuid,product_id uuid,variant_id uuid,quantity numeric,unit_price numeric,toppings jsonb,modifier_selections jsonb);
 create view _fnb_active_kitchen_items_00454 as select * from kitchen_order_items;
 create table fnb_cancel_requests(id uuid primary key,tenant_id uuid,branch_id uuid,kitchen_order_id uuid,context_hash text,expires_at timestamptz,executed_at timestamptz,whole_bill boolean);
 create table manager_otp_codes(id uuid primary key default gen_random_uuid(),tenant_id uuid,branch_id uuid,code_hash text,issued_by uuid,action_code text,target_meta jsonb,created_at timestamptz default now(),expires_at timestamptz,used_at timestamptz,used_by uuid,used_for_target jsonb);
 create function hash_manager_otp(text,uuid,uuid) returns text language sql immutable as $$select md5($1||$2::text||$3::text)$$;
`);
await db.exec(extract(await fs.readFile('supabase/migrations/00253_harden_retail_pos_pricing.sql','utf8'),'issue_manager_otp'));
await db.exec(`create function issue_manager_otp(text,jsonb,uuid) returns jsonb language sql as $$select issue_manager_otp($1,$2,$3,null::text,null::text)$$;`);
await db.exec(extract(await fs.readFile('supabase/migrations/00061_manager_otp_codes.sql','utf8'),'verify_and_use_manager_otp'));
await db.exec(extract(await fs.readFile('supabase/migrations/00066_otp_target_binding.sql','utf8'),'verify_otp_authorization'));
// Minimal boundary fixtures isolate the new guard logic. Existing money/stock
// implementations are additionally covered by unchanged database suites.
await db.exec(`create function public._fnb_complete_payment_impl_00343(p_kitchen_order_id uuid,p_customer_id uuid,p_customer_name text,p_payment_method text,p_payment_breakdown jsonb,p_paid numeric,p_allow_debt boolean,p_manual_discount_amount numeric,p_manual_discount_otp_id uuid,p_manual_discount_reason text,p_note text,p_shift_id uuid,p_tip_amount numeric,p_promotion_id uuid,p_coupon_code text) returns jsonb language plpgsql as $$
 declare v_manual_discount_approver uuid; v_manual_discount numeric:=p_manual_discount_amount; v_order record; v_order_subtotal numeric:=100000; v_coupon_code text:=p_coupon_code;
 begin select id,branch_id,0::numeric as discount_amount into v_order from kitchen_orders where id=p_kitchen_order_id;
 if v_manual_discount>0 then v_manual_discount_approver := public.verify_otp_authorization(p_manual_discount_otp_id,'fnb.discount_override',auth.uid(),v_order.id); end if;
  if p_promotion_id is not null then null; end if;
 return jsonb_build_object('success',true,'promotion',p_promotion_id,'coupon',v_coupon_code); end $$;
 create function public.pos_prepare_retail_checkout(p_tenant_id uuid,p_actor uuid,p_branch_id uuid,p_customer_id uuid,p_items jsonb,p_order_discount_source text,p_order_discount numeric,p_promotion_id uuid,p_coupon_code text,p_loyalty_points integer,p_discount_otp_id uuid,p_shipping_fee numeric,p_order_vat_rate numeric) returns jsonb language plpgsql as $$
 declare v_has_manual_discount boolean:=true; v_source text:=p_order_discount_source; v_order_discount numeric:=p_order_discount; v_trusted_items jsonb:=p_items;
 begin if v_has_manual_discount then perform public.verify_otp_authorization(p_discount_otp_id,'pos_retail.discount_override',p_actor,null); end if; return '{}'; end $$;
 create function checkout_internal_pos_v2(p_checkout jsonb) returns jsonb language plpgsql as $$
 declare v_line_disc numeric:=0;v_order_disc numeric:=1;v_branch uuid;v_draft uuid;v_session uuid;v_actor uuid:=auth.uid();
 begin if v_line_disc+v_order_disc>0 then perform verify_otp_authorization(nullif(p_checkout->>'discountOtpId','')::uuid,'pos_retail.discount_override',v_actor,null); end if;return '{}';end $$;
 create function delete_supplier_atomic(p_supplier_id uuid,p_actor_id uuid default null) returns jsonb language plpgsql security definer as $$
 declare v_actor uuid:=auth.uid();begin if p_actor_id is not null and p_actor_id <> v_actor then raise exception 'ACTOR_SPOOF_BLOCKED';end if;
 if not public.user_has_permission(v_actor, 'suppliers.delete') then raise exception 'DENIED';end if;delete from suppliers where id=p_supplier_id;return '{"success":true}';end $$;
`);
try { await db.exec(await fs.readFile('supabase/migrations/00566_manager_approval_requests.sql','utf8')); }
catch(e){console.error('MIGRATION',e.message,e.where,'at',e.position,'internal',e.internalPosition,e.internalQuery); const q=await fs.readFile('supabase/migrations/00566_manager_approval_requests.sql','utf8'); console.error(q.slice(Math.max(0,Number(e.position)-180),Number(e.position)+180)); process.exit(1);}
await db.exec(`insert into profiles(id,tenant_id,full_name) values('${id(1)}','${id(100)}','Manager'),('${id(2)}','${id(100)}','Staff'),('${id(3)}','${id(200)}','Foreign');
 insert into branches values('${id(10)}','${id(100)}','XTB'),('${id(11)}','${id(100)}','Other');
 insert into products values('${id(20)}','${id(100)}','P1','Coffee'),('${id(21)}','${id(200)}','P2','Foreign');
 insert into customers values('${id(30)}','${id(100)}','C1','Customer');
 insert into suppliers values('${id(31)}','${id(100)}','S1','Supplier');
 insert into grants select '${id(1)}',x from unnest(array['pos_fnb.discount','pos_retail.discount','customers.delete','suppliers.delete','products.delete','pos_fnb.void_paid_bill'])x;
 insert into grants select '${id(2)}',x from unnest(array['pos_fnb.send_kitchen','pos_retail.checkout','customers.view','suppliers.view','products.view','pos_fnb.view_orders'])x;
 insert into branch_grants values('${id(1)}','${id(10)}'),('${id(2)}','${id(10)}');
 insert into kitchen_orders values('${id(40)}','${id(100)}','${id(10)}',null,'pending','fnb-tab:draft-a');
 insert into kitchen_order_items values('${id(40)}','${id(20)}',null,2,50000,'[]','[]');`);
const actor=async n=>db.query(`select set_config('test.actor',$1,false)`,[id(n)]);
const call=async (sql,args=[]) => (await db.query(sql,args)).rows[0].v;
const rejects=async (sql,args,pattern)=>{await assert.rejects(call(sql,args),e=>pattern.test(e.message));};
const meta={branch_id:id(10),draft_key:'draft-a',label:'Test draft',subtotal:100000,amount:100000,items:[{productId:id(20),productName:'Coffee',quantity:2,unitPrice:50000,toppings:[]}]};
await actor(2);
const req=await call(`select request_manager_approval_00566('fnb.discount_override',$1,'Complimentary order') v`,[meta]);
const duplicate=await call(`select request_manager_approval_00566('fnb.discount_override',$1,'Complimentary order') v`,[meta]);assert.equal(req.id,duplicate.id);
assert.deepEqual(await call('select pending_manager_approvals_00566() v'),[]);
await rejects(`select request_manager_approval_00566('fnb.discount_override',$1,'Wrong branch') v`,[{...meta,branch_id:id(11)}],/BRANCH_ACCESS/);
await actor(1);assert.equal((await call('select pending_manager_approvals_00566() v')).length,1);
await rejects(`select issue_manager_otp('fnb.discount_override','{}',null,null::text,null::text) v`,[],/permission denied|REQUEST_REQUIRED/);
const issued=await call('select issue_manager_approval_otp_00566($1) v',[req.id]);
await actor(2);
await rejects(`select verify_and_use_manager_otp('000000','fnb.discount_override',$1) v`,[{approval_request_id:req.id}],/OTP_INVALID/);
await call(`select verify_and_use_manager_otp($1,'fnb.discount_override',$2) v`,[issued.code,{approval_request_id:req.id}]);
await db.query(`update manager_otp_codes set used_at=now()-interval '5 minutes' where id=$1`,[issued.otp_id]);
await rejects(`select _check_discount_approval_00566($1,'fnb.discount_override',$2,$3,90000,$4) v`,[issued.otp_id,id(10),id(40),meta.items],/AMOUNT_CHANGED/);
await rejects(`select _check_discount_approval_00566($1,'fnb.discount_override',$2,$3,100000,$4) v`,[issued.otp_id,id(10),id(40),[{...meta.items[0],quantity:1}]],/ITEMS_CHANGED/);
await db.exec('begin');
await call(`select _check_discount_approval_00566($1,'fnb.discount_override',$2,$3,100000,$4) v`,[issued.otp_id,id(10),id(40),meta.items]);
assert.equal(await call(`select verify_otp_authorization($1,'fnb.discount_override',$2,$3) v`,[issued.otp_id,id(2),id(40)]),id(1));
await db.exec('rollback');
assert.equal(await call('select status v from manager_approval_requests where id=$1',[req.id]),'authorized');
await db.query(`update branch_grants set branch=$1 where actor=$2`,[id(11),id(1)]);
await rejects(`select verify_otp_authorization($1,'fnb.discount_override',$2,$3) v`,[issued.otp_id,id(2),id(40)],/TARGET_CHANGED/);
await db.query(`update branch_grants set branch=$1 where actor=$2`,[id(10),id(1)]);
await call(`select _check_discount_approval_00566($1,'fnb.discount_override',$2,$3,100000,$4) v`,[issued.otp_id,id(10),id(40),meta.items]);
await call(`select verify_otp_authorization($1,'fnb.discount_override',$2,$3) v`,[issued.otp_id,id(2),id(40)]);
await rejects(`select verify_otp_authorization($1,'fnb.discount_override',$2,$3) v`,[issued.otp_id,id(2),id(40)],/SCOPE_DENIED/);
await actor(2);const customer=await call(`select request_manager_approval_00566('crm.delete_customer',$1,'Remove duplicate') v`,[{entity_id:id(30)}]);
await actor(1);await call(`select reject_manager_approval_00566($1,'Keep customer') v`,[customer.id]);
await actor(2);assert.equal((await call('select get_manager_approval_00566($1) v',[customer.id])).status,'rejected');
await actor(3);await rejects('select get_manager_approval_00566($1) v',[req.id],/PERMISSION_DENIED/);
await actor(1);await db.exec('set role authenticated');
await rejects('select verify_otp_authorization($1,$2,$3,$4) v',[issued.otp_id,'fnb.discount_override',id(2),id(40)],/permission denied/);
await db.exec('reset role');
console.log('PASS: migration, request dedup, permission/tenant/branch, scoped OTP, exact amount/items, >60s authorization, rollback, replay, rejection, private execution helper');
await db.close();
