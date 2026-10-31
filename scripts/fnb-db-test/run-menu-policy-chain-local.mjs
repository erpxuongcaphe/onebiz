import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { PGlite } = await import(process.argv[2] ? pathToFileURL(path.resolve(process.argv[2])).href : '@electric-sql/pglite');
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [actor,tenant,product,a,b]=[1,2,3,4,5].map(id);
await db.exec(`create schema auth;create schema extensions;
create function auth.uid() returns uuid language sql as $$select '${actor}'::uuid$$;
create table profiles(id uuid,tenant_id uuid,is_active boolean);
insert into profiles values('${actor}','${tenant}',true);
create table products(id uuid,tenant_id uuid,name text,product_type text,channel text);
insert into products values('${product}','${tenant}','Matcha','sku','fnb');
create table fnb_product_branch_menu_scopes(tenant_id uuid,product_id uuid,branch_id uuid);
create table fnb_product_branch_menu_policies(tenant_id uuid,product_id uuid,mode text);`);
function extract(file,name){
 const sql=readFileSync(file,'utf8');const start=sql.indexOf(`create or replace function public.${name}(`);
 assert(start>=0);return sql.slice(start,sql.indexOf('$function$;',start)+11);
}
const legacy=extract('supabase/migrations/00353_fnb_branch_menu_isolation.sql','fnb_send_to_kitchen_atomic_v2');
const signature=legacy.slice(0,legacy.indexOf('returns jsonb'));
await db.exec(signature.replace('fnb_send_to_kitchen_atomic_v2','_fnb_send_to_kitchen_impl_00350')+`returns jsonb language sql as $$select '{"ok":true}'::jsonb$$;`);
await db.exec(legacy.replace('public.fnb_send_to_kitchen_atomic_v2(','public._fnb_send_to_kitchen_impl_00353('));
await db.exec(extract('supabase/migrations/00354_fnb_branch_menu_exclusions.sql','fnb_send_to_kitchen_atomic_v2'));
const call=branch=>db.query(`select public.fnb_send_to_kitchen_atomic_v2('${branch}',p_items=>'[{"productId":"${product}"}]'::jsonb)`);
await db.exec(`insert into fnb_product_branch_menu_policies values('${tenant}','${product}','except');insert into fnb_product_branch_menu_scopes values('${tenant}','${product}','${b}');`);
await assert.rejects(call(a),/FNB_MENU_SCOPE_PRODUCT_NOT_AVAILABLE/); // reproduce live failure
const patch=readFileSync('supabase/migrations/20261030171330_fnb_legacy_menu_policy_alignment.sql','utf8');
await db.exec(patch);await db.exec(patch);
await call(a);await assert.rejects(call(b),/FNB_MENU_POLICY_PRODUCT_NOT_AVAILABLE/);
await db.exec(`update fnb_product_branch_menu_policies set mode='only'`);
await assert.rejects(call(a),/FNB_MENU_POLICY_PRODUCT_NOT_AVAILABLE/);await call(b);
await db.exec('delete from fnb_product_branch_menu_policies;delete from fnb_product_branch_menu_scopes');
await call(a);await call(b);
await db.exec(`insert into fnb_product_branch_menu_scopes values('${tenant}','${product}','${b}')`);
await assert.rejects(call(a),/FNB_MENU_SCOPE_PRODUCT_NOT_AVAILABLE/);await call(b);
console.log('PASS: live failure reproduced; except/only/legacy/global policies and idempotent migration verified');
await db.close();
