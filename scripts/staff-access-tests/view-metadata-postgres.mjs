// Exercises the actual view-replacement blocks against disposable PostgreSQL.
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {initializeStaffAccessFixture} from './fixture.mjs';
import {functionFromMigration} from './inventory.mjs';
if(process.env.STAFF_EPHEMERAL_DB!=='onebiz_staff_access_test')throw new Error('Dedicated disposable database required');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const read=n=>readFile(new URL(`../../supabase/migrations/${n}`,import.meta.url),'utf8');
function section(source,start,end){const i=source.indexOf(start),j=source.indexOf(end,i+start.length);if(i<0||j<0||source.indexOf(start,i+start.length)>=0)throw new Error(`Unexpected migration section: ${start}`);return source.slice(i,j);}
const sql=[];await initializeStaffAccessFixture({exec:async s=>sql.push(s)},id);
sql.push(`
 create function public._can_read_branch_inventory_00476(uuid,uuid,uuid) returns boolean language sql stable as $$select true$$;
 create function public._staff_production_row_visible(uuid) returns boolean language sql stable as $$select true$$;
 create function public._staff_inventory_row_visible(uuid) returns boolean language sql stable as $$select true$$;
 create function public._staff_inventory_movement_visible(uuid) returns boolean language sql stable as $$select true$$;
 create function public._staff_stocktake_action_branches() returns uuid[] language sql stable as $$select '{}'::uuid[]$$;
 create table production_orders(id uuid,tenant_id uuid,branch_id uuid);
 create table production_order_materials(id uuid,production_order_id uuid);
 create table inventory_checks(id uuid,tenant_id uuid,branch_id uuid);
 create table inventory_check_items(id uuid,check_id uuid);
 create table stock_movements(id uuid,tenant_id uuid,branch_id uuid);
 create view production_orders_scoped as select t.* from production_orders t join branches b on b.id=t.branch_id
  where _can_read_branch_inventory_00476(auth.uid(),t.tenant_id,t.branch_id);
 create view production_order_materials_scoped with (security_barrier=true) as select t.* from production_order_materials t
  where exists(select 1 from production_orders o where o.id=t.production_order_id and _can_read_branch_inventory_00476(auth.uid(),o.tenant_id,o.branch_id));
 create view inventory_check_items_scoped with (security_barrier=true) as select t.* from inventory_check_items t
  where exists(select 1 from inventory_checks o where o.id=t.check_id and _can_read_branch_inventory_00476(auth.uid(),o.tenant_id,o.branch_id));
 create view stock_movements_scoped with (security_barrier=true) as
  with _request_branch_candidates_20261029 as materialized
   (select distinct stock_movements.tenant_id,stock_movements.branch_id from stock_movements where tenant_id=(select get_user_tenant_id())),
  _request_allowed_branches_20261029 as materialized
   (select _request_branch_candidates_20261029.tenant_id,_request_branch_candidates_20261029.branch_id
    from _request_branch_candidates_20261029 where _can_read_branch_inventory_00476((select auth.uid() as uid),_request_branch_candidates_20261029.tenant_id,_request_branch_candidates_20261029.branch_id))
  select t.* from stock_movements t where exists(select 1 from _request_allowed_branches_20261029 access
   where access.tenant_id=t.tenant_id and access.branch_id is not distinct from t.branch_id);
 grant select on production_orders_scoped,production_order_materials_scoped,inventory_check_items_scoped,stock_movements_scoped to authenticated;
 create temp table original_view_metadata as select c.oid,c.relowner,c.relacl::text acl,c.reloptions from pg_class c
  where c.oid in ('production_orders_scoped'::regclass,'production_order_materials_scoped'::regclass,'inventory_check_items_scoped'::regclass,'stock_movements_scoped'::regclass);
`);
const prod=await read('20261112010015_staff_branch_production_read.sql');
sql.push(section(prod,'do $migration$','  source := pg_get_functiondef(\'public.get_production_order_list_workspace')+'end $migration$;');
const inv=await read('20261112012240_staff_branch_inventory_document_read.sql');
sql.push(`do $test$ declare source text;scope_anchor constant text := '_can_read_branch_inventory_00476(auth.uid(), o.tenant_id, o.branch_id)';old_acl text;old_owner oid;old_options text[];begin\n${section(inv,'  select pg_get_viewdef(c.oid,true),c.relacl::text','  for item in select * from (values')}\nend $test$;`);
const stock=await read('20261112124158_staff_stocktake_action_document_reads.sql');
sql.push(`do $test$ declare source text;row_anchor text;old_acl text;old_owner oid;old_options text[];begin\n${section(stock,' select pg_get_viewdef(c.oid,true),c.relacl::text',' alter policy staff_inventory_document_read')}\nend $test$;`);
const movement=await read('20261112104123_staff_inventory_direct_stock_scope.sql');
sql.push(section(movement,'do $migration$','commit;'));
sql.push(`
 do $$begin
  if exists(select 1 from original_view_metadata x join pg_class c on c.oid=x.oid
   where c.relowner<>x.relowner or c.relacl::text is distinct from x.acl or c.reloptions is distinct from x.reloptions)
   then raise exception 'view security metadata changed';end if;
  if position('_staff_production_row_visible' in pg_get_viewdef('production_order_materials_scoped'::regclass,true))=0
   or position('_staff_stocktake_action_branches' in pg_get_viewdef('inventory_check_items_scoped'::regclass,true))=0
   then raise exception 'expected scope change missing';end if;
 end$$;
`);
sql.push(await functionFromMigration('00223_stock_card_read_rpc.sql','get_stock_card_v2'));
sql.push(`
 revoke all on function public.get_stock_card_v2(uuid,uuid) from public,anon;
 grant execute on function public.get_stock_card_v2(uuid,uuid) to authenticated;
 create temp table original_stock_card_metadata as select proowner,proacl::text acl,proconfig,prosecdef,provolatile
  from pg_proc where oid='public.get_stock_card_v2(uuid,uuid)'::regprocedure;
`);
sql.push(await read('20261113073019_staff_stock_card_cost_guard.sql'));
sql.push(await read('20261113073019_staff_stock_card_cost_guard.sql'));
sql.push(`
 do $$declare source text;begin
  select pg_get_functiondef('public.get_stock_card_v2(uuid,uuid)'::regprocedure) into source;
  if position('case when v_can_view_cost then sm.unit_cost else null end as unit_cost' in source)=0
   or position('case when v_can_view_cost then sm.unit_price else null end as unit_price' in source)=0
   then raise exception 'stock card cost mask missing';end if;
  if exists(select 1 from original_stock_card_metadata x join pg_proc p on p.oid='public.get_stock_card_v2(uuid,uuid)'::regprocedure
   where p.proowner<>x.proowner or p.proacl::text is distinct from x.acl or p.proconfig is distinct from x.proconfig
    or p.prosecdef is distinct from x.prosecdef or p.provolatile is distinct from x.provolatile)
   then raise exception 'stock card security metadata changed';end if;
 end$$;
`);
if(process.env.ONEBIZ_PGLITE_MODULE){const {PGlite}=await import(pathToFileURL(process.env.ONEBIZ_PGLITE_MODULE).href);const db=new PGlite();try{await db.exec(sql.join('\n'));}catch(e){console.error(e.message,e.where||'');process.exitCode=1;}finally{await db.close();}if(process.exitCode)process.exit(process.exitCode);console.log('PASS view metadata rehearsal (PGlite)');process.exit(0);}
const child=spawn('psql',['-Xq','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55433','-U','staff_test','-d','onebiz_staff_access_test'],{env:{PATH:process.env.PATH,PGPASSWORD:'ephemeral-test-only',PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5'},stdio:['pipe','pipe','pipe']});
let err='';child.stderr.on('data',x=>err+=x);child.stdout.resume();const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(err)));});child.stdin.end(sql.join('\n'));await done;
console.log('PASS real PostgreSQL: replaced views preserve barriers, owner and grants');
