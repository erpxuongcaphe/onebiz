-- Activate Hub branch controls only after every reviewed server guard is present.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare x record;begin
 for x in select * from (values
 ('public.ops_access_context()','78f25a14d3e86ce447034074179babf7'),
 ('public.ops_can(uuid,text)','86edf24295214becf73356a5bfdfb8d4'),
 ('public.ops_evidence_reserve_before_lifecycle(text,uuid,text,text,bigint)','3be61d7a42f0be54e7086f11d12a80c5'),
 ('public.ops_filtered_page(text,uuid,text,boolean,jsonb,timestamp with time zone,uuid)','575dc90d11a0f1edf176a40ec1496416'),
 ('public.ops_manager(uuid,uuid)','a035a09fa44e0d035cec3592f320a8a3'),
 ('public.ops_person_eligible(uuid,uuid,text)','efed5b2e0535c041c9ba6e73ae14ed3a'),
 ('public.ops_q_can(uuid,text)','a18f560cfd92eb2dc94e48f2eb4a7691'),
 ('public.ops_q_new_issue(uuid,jsonb,uuid)','de1f34f5c34f13e6a9a1c32e85fc83a5'),
 ('public.ops_quality_execute_before_lifecycle(text,jsonb,uuid)','c6aaf8a742e8a9176e5a5ac820805c1c'),
 ('public.ops_quality_execute_core(text,jsonb,uuid)','1150d4cbf985eb1a496082d301dc5a31'),
 ('public.ops_todo_page(uuid,text,boolean,boolean,timestamp with time zone,uuid)','23d4320af9c9e73aa5331693b63ec16d'),
 ('public.ops_todo_visible(uuid)','dad994bc2c186ab4d5f89c72ce64d21e'),
 ('public.ops_workspace(uuid,text)','d5de5773d9676e01b5900e4311b79f2b')
 ) v(signature,expected) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(x.signature) and p.prosecdef and md5(replace(p.prosrc,chr(13),''))=x.expected) then raise exception 'HUB_CATALOG_GUARD_FAILED: %',x.signature;end if;
 end loop;
 if exists(select 1 from public.staff_branch_permission_catalog where permission_code in ('ops.view','ops.work','ops.verify','ops.configure','ops.close_period','ops.cancel_todo','ops.manage_members')) then raise exception 'HUB_CATALOG_ALREADY_PRESENT';end if;
end$$;
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version) values
 ('ops.view',1),('ops.work',1),('ops.verify',1),('ops.configure',1),('ops.close_period',1),('ops.cancel_todo',1),('ops.manage_members',1);
commit;
