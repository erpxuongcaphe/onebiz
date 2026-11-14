-- Activate only after every reviewed MKT guard and policy is installed.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare x record;begin
 for x in select * from (values
('public._staff_mkt_campaign_permission(uuid,text,uuid)','b85c8f8376bc6d6da8bb279ab3cf61ab'),
('public._staff_mkt_linked_permission(uuid,text,uuid,uuid,uuid,uuid)','1498e073526dc4cc535f7607439a00fd'),
('public._staff_mkt_read_campaign(uuid)','db5fdc55a6874ff62727da56fe9a6251'),
('public._staff_mkt_read_workflow(text,uuid)','310cde8854511aaba7541a9250d7dd75'),
('public._staff_mkt_task_tree_allowed(uuid,uuid)','b0799117327dc2a8500c31cff52e0db2'),
('public._staff_mkt_view_asset(text,uuid)','72ba3039374f55616d0705a6e4b4fc62'),
('public._staff_mkt_view_campaign(uuid)','a4673a3f245351a27ae6337df9eb0f11'),
('public.mkt_add_readiness_item(uuid,text,text,uuid,timestamp with time zone)','e66294550619e17726234d0133ce3c94'),
('public.mkt_approve_task_review(uuid)','9917437aa526161e9a146933b88817c4'),
('public.mkt_assign_channel_planning(uuid,uuid,uuid,jsonb)','dd45a82ffaba47f8165537f0f4f2c658'),
('public.mkt_campaign_create_branches()','49760d245150df636fd23bf8fdb671b0'),
('public.mkt_campaign_plan_delete(uuid)','977545f609a8b2f5d1d6a6e2b1c66adc'),
('public.mkt_campaign_plan_upsert(uuid,uuid,text,text,uuid,date,date,uuid)','1fe1a84cdd4ed87e364bac51333400fc'),
('public.mkt_campaign_ui_permissions(uuid)','3f216098781ccc5fba243b8040d61379'),
('public.mkt_can_read_plan(uuid)','5350ca6063773ff94b135f561fef91c6'),
('public.mkt_cancel_task(uuid,text)','292a69891c95ffc1fae8eebaa8c26031'),
('public.mkt_change_campaign_status(uuid,text,text)','e14e7739181c3d9d548fb0ca4fea1a89'),
('public.mkt_create_campaign(text,text,date,date,numeric,uuid,uuid,jsonb)','894483b5606a42b694f7c8b30865444b'),
('public.mkt_create_content_item(uuid,uuid,text,text,text,uuid)','dacdff4e42c1fd3370421e724277d76d'),
('public.mkt_create_manual_task(text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone,integer)','a1690d7f42487a2616357931cb8ecaa4'),
('public.mkt_create_work_package(uuid,text,text,text,uuid,uuid,uuid)','471ac6e9218ccf427542a4c6a79bdd2b'),
('public.mkt_delete_campaign(uuid,text)','97e4574a31a089ec49463c67662e97c6'),
('public.mkt_delete_content_item(uuid)','3d1df1f27c5c786205f1876d46cb51fe'),
('public.mkt_delete_plan_progress_report(uuid,text)','bbb5ae2e1cbdd965e8784d09c45579c9'),
('public.mkt_delete_readiness_item(uuid)','5aba8c053d7a77d8ba6c4aa48f880517'),
('public.mkt_delete_task(uuid,text)','a464f1ac0310fa574fb0fa5fd117aaea'),
('public.mkt_delete_work_package(uuid,text)','a5ba79d8ed21359656c28693c0723e48'),
('public.mkt_get_leader_queue(uuid,integer,integer)','b4895cd91fc9a638bd2f78d42d80bad3'),
('public.mkt_get_my_context()','0ed1c3942c8ade8361a13e65db55582f'),
('public.mkt_manageable_campaign_ids(uuid[])','cad3d23a56e343dcfbae470a4db5beb9'),
('public.mkt_open_plan_change_request(uuid,text)','ad05964f4168dd53fc1fabd89b2cc56f'),
('public.mkt_owner_add_subplan(uuid,text,text)','a8873d3447b6b0120c5e11690194f942'),
('public.mkt_reassign_task(uuid,uuid,text)','475248403ad38289fb9ff60503c1a8ba'),
('public.mkt_reconcile_plan_task(uuid,uuid,text,uuid,text)','2fbd99e74965904f22f24186da8ff483'),
('public.mkt_remind_readiness_item(uuid,uuid)','1b28bcb77f91d5c76aaff87d5752f7f3'),
('public.mkt_return_task_review(uuid,text)','2f301945fdb3aa9ecc827c4fb40f9d62'),
('public.mkt_review_plan(uuid,uuid,text,text)','189074de1d9afa313a112500db9abddd'),
('public.mkt_save_plan_items(uuid,jsonb,jsonb,integer,jsonb)','b9fcf29dad9c9177b3491ca432ed1033'),
('public.mkt_save_plan_strategy(uuid,text,numeric,jsonb,integer)','91c7fd2d27ca0ae7d99013204d965766'),
('public.mkt_split_work_package(uuid,jsonb,text)','c0d08804011d2afd3b627aed692fe447'),
('public.mkt_submit_plan(uuid,integer)','514fb90723ef8d574dbb02a15e00e877'),
('public.mkt_submit_plan_progress(uuid,text,text,text,text,jsonb)','10bea063314562da77e3fd2cef2d8543'),
('public.mkt_update_campaign(uuid,jsonb)','f822b4288a0832ca324d275ddea41229'),
('public.mkt_waive_readiness_item(uuid,uuid,text)','54f54489ab1f40c442dfcc32209cb78e'),
('public.mkt_work_package_set_campaign_plan(uuid,uuid)','b5314b03d5fe5dcf18add76040ac85b6')
 ) v(signature,expected) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(x.signature) and p.prosecdef and md5(replace(p.prosrc,chr(13),''))=x.expected) then raise exception 'MKT_CATALOG_FUNCTION_GUARD_FAILED: %',x.signature;end if;
 end loop;
 for x in select * from (values
('public.mkt_campaign_plans','mkt_campaign_plans_select','f24b52567c59a36b1bd9855872582c4b'),
('public.mkt_campaigns','mkt_campaigns_select','64f4141b30590f2c262f380003ceec8a'),
('public.mkt_content_items','mkt_content_items_select','493125efdd6a9249af3bb3b5a242f210'),
('public.mkt_content_reviews','mkt_content_reviews_select','ed3c41ecd0e65d9ccf39cda0c7d91f6e'),
('public.mkt_content_versions','mkt_content_versions_select','995896d16c731b4ff266acc8a3a9f1de'),
('public.mkt_documents','mkt_documents_select','4aa7dc712ca5a83ff33878c3d6bdb1a6'),
('public.mkt_media_assets','mkt_media_select','27f85dca36aea53cc7c8b236761e56ed'),
('public.mkt_content_pillar_angles','mkt_pillar_angles_select','043127e6efcc1610d56a1e0390d17a4f'),
('public.mkt_content_pillars','mkt_pillars_select','043127e6efcc1610d56a1e0390d17a4f'),
('public.mkt_campaign_readiness_items','mkt_readiness_select','002f5bf77212bfc7a751d60acd18216b'),
('public.mkt_tasks','mkt_tasks_select','a83860fbc5651e8896ed1b99d3a0388e'),
('public.mkt_workflow_templates','mkt_templates_select','043127e6efcc1610d56a1e0390d17a4f'),
('public.mkt_channel_work_packages','mkt_work_packages_select','db94ea21bf5c12782732d688c39cbaca')
 ) v(table_name,policy_name,expected) loop
  if not exists(select 1 from pg_policy p where p.polrelid=to_regclass(x.table_name) and p.polname=x.policy_name and md5(pg_get_expr(p.polqual,p.polrelid))=x.expected) then raise exception 'MKT_CATALOG_POLICY_GUARD_FAILED: %',x.policy_name;end if;
 end loop;
 if exists(select 1 from public.staff_branch_permission_catalog where permission_code in ('mkt.view','mkt.manage_campaigns','mkt.split_work_packages')) then raise exception 'MKT_CATALOG_ALREADY_PRESENT';end if;
end$$;
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version) values ('mkt.view',1),('mkt.manage_campaigns',1),('mkt.split_work_packages',1);
commit;
