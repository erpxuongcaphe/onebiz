import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { PGlite } = await import(process.argv[2] ? pathToFileURL(path.resolve(process.argv[2])).href : '@electric-sql/pglite');
import { readFileSync,writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [tenant,actor,a,b,c,p,q,retail,other]=[1,2,3,4,5,6,7,8,9].map(id);
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema extensions;
create function auth.uid() returns uuid language sql as $$select current_setting('test.actor',true)::uuid$$;
create function get_user_tenant_id() returns uuid language sql as $$select '00000000-0000-0000-0000-000000000001'::uuid$$;
create function user_has_permission(uuid,text) returns boolean language sql as $$select coalesce(current_setting('test.permission',true),'yes')='yes'$$;
create function user_has_branch_access(uuid,uuid) returns boolean language sql as $$select $2::text<>coalesce(current_setting('test.denied',true),'')$$;
create table profiles(id uuid primary key,tenant_id uuid,is_active boolean);
create table branches(id uuid primary key,tenant_id uuid,is_active boolean,cascade_mode text,branch_type text);
create table products(id uuid primary key,tenant_id uuid,is_active boolean,product_type text,channel text,code text,name text,updated_at timestamptz);
create table fnb_product_branch_menu_policies(id uuid default gen_random_uuid(),tenant_id uuid,product_id uuid unique,mode text check(mode in ('only','except')));
create table fnb_product_branch_menu_scopes(id uuid default gen_random_uuid(),tenant_id uuid,product_id uuid,branch_id uuid,unique(product_id,branch_id));
create table audit_log(id uuid default gen_random_uuid(),tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,old_data jsonb,new_data jsonb);
insert into profiles values('${actor}','${tenant}',true);
insert into branches values('${a}','${tenant}',true,'outlet','store'),('${b}','${tenant}',true,'outlet','store'),('${c}','${tenant}',true,'outlet','store');
insert into products values('${p}','${tenant}',true,'sku','fnb','P','Coffee',null),('${q}','${tenant}',true,'sku','fnb','Q','Tea',null),('${retail}','${tenant}',true,'sku','retail','R','Retail',null),('${other}','${id(99)}',true,'sku','fnb','X','Other',null);
set test.actor='${actor}';set test.permission='yes';`);
const original=readFileSync('supabase/migrations/00354_fnb_branch_menu_exclusions.sql','utf8');
const start=original.indexOf('create or replace function public.save_fnb_product_branch_menu_policy(');
await db.exec(original.slice(start,original.indexOf('$function$;',start)+11));
function installGuard(file,name,table) {
 const text=readFileSync(file,'utf8');const start=text.indexOf('create or replace function public.'+name+'(');
 assert(start>=0,name);const end=text.indexOf('$function$;',start)+11;
 return db.exec(text.slice(start,end)+`\ncreate trigger test_${name} before insert or update on ${table} for each row execute function public.${name}();`);
}
await installGuard('supabase/migrations/00353_fnb_branch_menu_isolation.sql','enforce_fnb_product_branch_menu_scope_00353','fnb_product_branch_menu_scopes');
await installGuard('supabase/migrations/00354_fnb_branch_menu_exclusions.sql','enforce_fnb_product_branch_menu_policy_00354','fnb_product_branch_menu_policies');

await db.exec(readFileSync('supabase/migrations/00559_product_trading_status.sql','utf8'));
await db.exec(readFileSync('supabase/migrations/202610250100_fnb_branch_trading_status.sql','utf8'));

await db.exec(readFileSync('supabase/migrations/20261027053919_fnb_restore_at_selected_branch.sql','utf8'));
const results=[];
const run=async(name,fn)=>{await fn();results.push({name,passed:true});};
const toggle=(ids,active,branch=a)=>db.query('select set_fnb_branch_trading_status_20261025($1::uuid[],$2,$3::uuid) n',[ids,active,branch]);
const active=async(product)=>(await db.query('select is_active from products where id=$1',[product])).rows[0].is_active;
const visible=async(product,branch)=>(await db.query(`select is_active and case (select mode from fnb_product_branch_menu_policies where product_id=$1) when 'only' then exists(select 1 from fnb_product_branch_menu_scopes where product_id=$1 and branch_id=$2) when 'except' then not exists(select 1 from fnb_product_branch_menu_scopes where product_id=$1 and branch_id=$2) else true end v from products where id=$1`,[product,branch])).rows[0].v;
const stop=product=>db.query('update products set is_active=false where id=$1',[product]);
await run('restore global stop with no policy opens selected outlet only',async()=>{
  await stop(p); assert.equal((await toggle([p],true)).rows[0].n,1);
  assert.equal(await active(p),true); assert.equal(await visible(p,a),true);
  for(const branch of [b,c,id(555)])assert.equal(await visible(p,branch),false);
});
await run('repeat restore is idempotent, does not duplicate audit',async()=>{
  const before=(await db.query('select count(*)::int n from audit_log')).rows[0].n;
  assert.equal((await toggle([p,p],true)).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from audit_log')).rows[0].n,before);
});
await run('restore from ONLY and EXCEPT policies preserves effective off elsewhere',async()=>{
  for(const mode of ['only','except']) {
    await db.query('select save_fnb_product_branch_menu_policy($1,$2,$3)',[q,mode,[a,b]]);
    await stop(q);assert.equal((await toggle([q],true,c)).rows[0].n,1);
    assert.equal(await visible(q,c),true);for(const branch of [a,b,id(555)])assert.equal(await visible(q,branch),false);
  }
});
await run('restore from empty whitelist opens selected outlet',async()=>{
  await db.query('select save_fnb_product_branch_menu_policy($1,$2,$3)',[q,'only',[a]]); await toggle([q],false);
  await stop(q);await toggle([q],true,b);assert.equal(await visible(q,b),true);assert.equal(await visible(q,a),false);
});
await run('subsequent outlet restore adds that outlet without removing the first',async()=>{
  await toggle([q],true,c); assert.equal(await visible(q,b),true);assert.equal(await visible(q,c),true);assert.equal(await visible(q,a),false);
});
await run('mixed active and globally stopped bulk restores atomically',async()=>{
  await stop(q);await toggle([p],false);assert.equal((await toggle([p,q,p],true)).rows[0].n,2);
  assert.equal(await visible(p,a),true);assert.equal(await visible(q,a),true);assert.equal(await visible(q,b),false);
});
await run('invalid bulk never partially restores a global stop',async()=>{
  await stop(q);for(const ids of [[q,id(444)],[q,retail],[q,other]]){await assert.rejects(toggle(ids,true));assert.equal(await active(q),false);}
});
await run('restore checks edit, branch and active-profile permissions',async()=>{
  await db.exec("set test.permission='no'");await assert.rejects(toggle([q],true));await db.exec("set test.permission='yes'");
  await db.query("select set_config('test.denied',$1,false)",[a]);await assert.rejects(toggle([q],true));await db.exec("set test.denied=''");
  await db.exec('update profiles set is_active=false');await assert.rejects(toggle([q],true));await db.exec('update profiles set is_active=true');
  assert.equal(await active(q),false);
});
await run('restore rejects warehouse, inactive and foreign-tenant branches',async()=>{
  await db.query('insert into branches values($1,$2,true,$3,$4),($5,$2,false,$6,$7),($8,$9,true,$6,$7)',[id(20),tenant,'warehouse','warehouse',id(21),'outlet','store',id(22),id(99)]);
  for(const branch of [id(20),id(21),id(22),null])await assert.rejects(toggle([q],true,branch));assert.equal(await active(q),false);
});
await run('stopping a globally stopped product is a no-op',async()=>{
  assert.equal((await toggle([q],false)).rows[0].n,0);assert.equal(await active(q),false);
});
await run('audit records previous policy and master restore',async()=>{
  await toggle([q],true);
  const audit=(await db.query("select old_data,new_data from audit_log where entity_id=$1 and new_data->>'source'='fnb_trading_restore' order by ctid desc limit 1",[q])).rows[0];
  assert.equal(audit.old_data.is_active,false);assert.equal(audit.new_data.is_active,true);assert.equal(audit.new_data.branch_id,a);assert.equal(audit.new_data.menu_mode,'only');assert.ok(Array.isArray(audit.old_data.menu_branch_ids));
});
await run('old browser still cannot change global FnB status',async()=>{
  await assert.rejects(db.query('select set_product_trading_status_00559($1,true)',[[q]]));
});
await run('unrelated products unchanged',async()=>{assert.equal(await active(retail),true);assert.equal(await active(other),true);});
await run('invalid requests rejected before restoring anything',async()=>{
  await stop(q);for(const ids of [[],[null],[q,null]])await assert.rejects(toggle(ids,true));
  await assert.rejects(toggle([q],null));assert.equal(await active(q),false);
});
await run('failure after a first item restores rolls back the entire batch',async()=>{
  await stop(p);await stop(q);
  await db.exec(`create function fail_second_restore() returns trigger language plpgsql as $$begin if new.id='${q}' then raise exception 'test restore failure';end if;return new;end$$;
    create trigger fail_second before update on products for each row execute function fail_second_restore();`);
  const before=(await db.query('select count(*)::int n from audit_log')).rows[0].n;
  await assert.rejects(toggle([p,q],true));assert.equal(await active(p),false);assert.equal(await active(q),false);
  assert.equal((await db.query('select count(*)::int n from audit_log')).rows[0].n,before);
  await db.exec('drop trigger fail_second on products');
});
await run('RPC remains unavailable to anonymous callers',async()=>{assert.equal((await db.query("select has_function_privilege('anon','set_fnb_branch_trading_status_20261025(uuid[],boolean,uuid)','execute') v")).rows[0].v,false);});
console.log(JSON.stringify({passed:results.length,results},null,2));await db.close();
