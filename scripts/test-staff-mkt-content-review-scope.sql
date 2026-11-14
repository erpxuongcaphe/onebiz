\set ON_ERROR_STOP on
do $$begin
 if current_database() <> 'onebiz_hub_scope_v6_20261114' or inet_server_addr() <> '127.0.0.1'::inet or inet_server_port() <> 55487 or exists(select 1 from public.tenants) then raise exception 'WRONG_TEST_DATABASE'; end if;
end$$;
begin;
insert into public.tenants(id,name,slug) values ('11000000-0000-0000-0000-000000000001','Synthetic','review-scope-test');
insert into auth.users(id) values ('22000000-0000-0000-0000-000000000002');
insert into public.branches(id,tenant_id,name,branch_type) values
 ('33000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','A','store'),
 ('33000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','B','store');
insert into public.roles(id,tenant_id,name) values ('44000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Synthetic reviewer');
insert into public.profiles(id,tenant_id,branch_id,full_name,role,role_id) values ('22000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Synthetic','staff','44000000-0000-0000-0000-000000000001');
insert into public.user_branches(user_id,branch_id) values ('22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000002');
insert into public.mkt_campaigns(id,tenant_id,branch_id,name) values
 ('66000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','A'),
 ('66000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002','B'),
 ('66000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000001',null,'Shared');
insert into public.mkt_content_pillars(id,tenant_id,code,name) values ('88000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','SYN','Synthetic');
insert into public.mkt_content_items(id,tenant_id,campaign_id,pillar_id,title,content_status,current_version) values
 ('99000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000001','88000000-0000-0000-0000-000000000001','A','pending_review',1),
 ('99000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000002','88000000-0000-0000-0000-000000000001','B','pending_review',1),
 ('99000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000003','88000000-0000-0000-0000-000000000001','Shared','pending_review',1);
insert into public.mkt_content_versions(id,tenant_id,content_item_id,version_number,status) values
 ('ee000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001',1,'pending'),
 ('ee000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000002',1,'pending'),
 ('ee000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000003',1,'pending');
insert into public.staff_branch_permission_catalog values ('mkt.review_content',1) on conflict do nothing;
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000001','mkt.review_content','grant','22000000-0000-0000-0000-000000000002');
update public.mkt_content_items set risk_level='high' where id='99000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','22000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$begin
 if not (public.mkt_get_my_context()->>'canReview')::boolean then raise exception 'REVIEW_CONTEXT_MISSING'; end if;
 if public.mkt_reviewable_content_ids(array['99000000-0000-0000-0000-000000000001'::uuid,'99000000-0000-0000-0000-000000000002'::uuid,'99000000-0000-0000-0000-000000000003'::uuid]) <> array['99000000-0000-0000-0000-000000000001'::uuid] then raise exception 'REVIEW_BUTTON_SCOPE_FAILED'; end if;
 if not exists(select 1 from public.mkt_content_items where id='99000000-0000-0000-0000-000000000001') or exists(select 1 from public.mkt_content_items where id in ('99000000-0000-0000-0000-000000000002','99000000-0000-0000-0000-000000000003')) then raise exception 'REVIEW_READ_SCOPE_FAILED'; end if;
 if not exists(select 1 from public.mkt_content_versions where id='ee000000-0000-0000-0000-000000000001') or exists(select 1 from public.mkt_content_versions where id='ee000000-0000-0000-0000-000000000002') then raise exception 'REVIEW_VERSION_SCOPE_FAILED'; end if;
 begin perform public.mkt_review_content('99000000-0000-0000-0000-000000000002',null,'approve',null); raise exception 'REVIEW_OUTSIDE_SCOPE_ALLOWED'; exception when raise_exception then if sqlerrm <> 'INSUFFICIENT_ROLE' then raise; end if; end;
 begin perform public.mkt_review_content('99000000-0000-0000-0000-000000000003',null,'approve',null); raise exception 'REVIEW_SHARED_ALLOWED'; exception when raise_exception then if sqlerrm <> 'INSUFFICIENT_ROLE' then raise; end if; end;
 begin perform public.mkt_review_content('99000000-0000-0000-0000-000000000001',null,'approve',null); raise exception 'REVIEW_HIGH_RISK_ALLOWED'; exception when raise_exception then if sqlerrm not like 'INSUFFICIENT_ROLE: %' then raise; end if; end;
end$$;
reset role;
update public.mkt_content_items set risk_level='low' where id='99000000-0000-0000-0000-000000000001';
set local role authenticated;
do $$begin
 perform public.mkt_review_content('99000000-0000-0000-0000-000000000001',null,'approve',null);
end$$;
reset role;
insert into public.role_permissions(role_id,permission_code) values ('44000000-0000-0000-0000-000000000001','mkt.review_content');
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000002','mkt.review_content','revoke','22000000-0000-0000-0000-000000000002');
set local role authenticated;
do $$begin
 if not exists(select 1 from public.mkt_content_items where id='99000000-0000-0000-0000-000000000003') or exists(select 1 from public.mkt_content_items where id='99000000-0000-0000-0000-000000000002') then raise exception 'REVIEW_INHERITED_SCOPE_FAILED'; end if;
 if public.mkt_reviewable_content_ids(array['99000000-0000-0000-0000-000000000002'::uuid,'99000000-0000-0000-0000-000000000003'::uuid]) <> array['99000000-0000-0000-0000-000000000003'::uuid] then raise exception 'REVIEW_BUTTON_INHERITED_SCOPE_FAILED'; end if;
 begin perform public.mkt_review_content('99000000-0000-0000-0000-000000000002',null,'approve',null); raise exception 'REVIEW_BRANCH_REVOKE_FAILED'; exception when raise_exception then if sqlerrm <> 'INSUFFICIENT_ROLE' then raise; end if; end;
 perform public.mkt_review_content('99000000-0000-0000-0000-000000000003',null,'approve',null);
end$$;
reset role;
insert into public.user_permission_overrides(tenant_id,user_id,permission_code,override_type) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','mkt.review_content','revoke');
set local role authenticated;
do $$begin
 if (public.mkt_get_my_context()->>'canReview')::boolean then raise exception 'REVIEW_GLOBAL_REVOKE_CONTEXT_FAILED'; end if;
 begin perform public.mkt_review_content('99000000-0000-0000-0000-000000000002',null,'approve',null); raise exception 'REVIEW_GLOBAL_REVOKE_FAILED'; exception when raise_exception then if sqlerrm <> 'INSUFFICIENT_ROLE' then raise; end if; end;
end$$;
rollback;
