-- Disposable database: run after 00452_fnb_cancel.setup.sql, not production.
alter table profiles add column full_name text;
alter table manager_otp_codes add column branch_id uuid, add column expires_at timestamptz, add column created_at timestamptz default now();
alter table pos_exception_events add column invoice_id uuid, add column created_at timestamptz default now();
create table branches(id uuid primary key, tenant_id uuid, name text);
create table invoices(id uuid primary key, tenant_id uuid, branch_id uuid, code text);
create table audit_log(id uuid primary key, tenant_id uuid, user_id uuid, action text, entity_type text, entity_id uuid, old_data jsonb, new_data jsonb, ip_address text, created_at timestamptz);
create or replace function user_has_branch_access(p_actor uuid, p_branch uuid) returns boolean language sql as $$
 select coalesce((select role='owner' or branch_id=p_branch from profiles where id=p_actor),false)
$$;
create or replace function user_has_permission(p_actor uuid, p_permission text) returns boolean language sql as $$
 select coalesce((select role in ('owner','manager') from profiles where id=p_actor),false)
$$;
\ir ../migrations/00453_unified_operation_history.sql
select test_fixture();
update profiles set full_name = case when id=test_id(1) then 'Chủ quán' else 'Thu ngân' end;
insert into branches values(test_id(3),test_id(2),'Xưởng Tư Búa'),(test_id(99),test_id(2),'Kho Tổng'),(test_id(90),test_id(91),'Khác tenant');
insert into audit_log values
 (test_id(101),test_id(2),test_id(1),'fnb_send_to_kitchen','kitchen_order',test_id(10),null,
 '{"code":"KB000010","nested":{"otp_code":"123456","password":"private","name":"giữ lại"}}',null,'2026-10-08 08:45:00+07'),
 (test_id(102),test_id(2),test_id(1),'pos_checkout_completed','invoice',test_id(80),null,
 jsonb_build_object('code','HD000080','branch_id',test_id(3)),null,'2026-10-08 09:00:00+07'),
 (test_id(103),test_id(2),test_id(1),'update','product',test_id(70),null,'{"name":"Dữ liệu cũ chưa ghi chi nhánh"}',null,'2026-10-08 09:10:00+07'),
 (test_id(104),test_id(91),test_id(1),'fnb_send_to_kitchen','kitchen_order',test_id(10),null,null,null,'2026-10-08 08:45:00+07'),
 (test_id(105),test_id(2),test_id(1),'update','product',test_id(71),null,jsonb_build_object('branch_id',test_id(99)),null,'2026-10-08 09:20:00+07');
insert into pos_exception_events(tenant_id,branch_id,source,event_type,target_type,target_id,kitchen_order_id,requested_by,approved_by,amount,created_at)
 values(test_id(2),test_id(3),'fnb','cancel_unpaid_order','kitchen_order',test_id(11),test_id(11),test_id(4),test_id(1),30000,'2026-10-08 08:50:00+07');
update manager_otp_codes set branch_id=test_id(3),created_at='2026-10-08 08:49:00+07',expires_at='2026-10-08 08:51:00+07';
select test_assert((get_operation_history_00453()->>'total')::int=6,'tenant isolation; owner sees all own branches and unscoped legacy');
select test_assert((get_operation_history_00453(p_branch_id=>test_id(3))->>'total')::int=4,'selected branch count');
select test_assert((get_operation_history_00453(p_source=>'fnb')->>'total')::int=3,'FNB audit, exception and approval');
select test_assert((get_operation_history_00453(p_source=>'retail')->>'total')::int=1,'explicit retail source');
select test_assert((get_operation_history_00453(p_actor_id=>test_id(4))->>'total')::int=1,'actor filter');
select test_assert((get_operation_history_00453(p_approver_id=>test_id(1))->>'total')::int=2,'approver filter');
select test_assert((get_operation_history_00453(p_from=>'2026-10-08 08:45:00+07',p_to=>'2026-10-08 08:50:00+07')->>'total')::int=2,'inclusive start, exclusive end');
select test_assert((get_operation_history_00453(p_search=>'KB000010')->>'total')::int=1,'search human bill code rather than UUID ilike');
select test_assert((get_operation_history_00453(p_search=>'Xưởng Tư Búa')->>'total')::int=4,'search branch');
select test_assert(jsonb_array_length(get_operation_history_00453(p_page_size=>2)->'data')=2 and (get_operation_history_00453(p_page=>3,p_page_size=>2)->>'total')::int=6,'pagination preserves exact filtered total on empty page');
select test_assert(get_operation_history_00453()::text !~ '123456|private|code_hash','secrets excluded from result');
select test_assert(get_operation_history_00453()::text like '%giữ lại%','nested nonsecret data retained');
select test_assert((get_operation_history_00453(p_action=>'otp_issued')->>'total')::int=1,'approval is not completed cancellation');
select test_reject('select get_operation_history_00453(p_branch_id=>test_id(90))','AUDIT_BRANCH_ACCESS_DENIED');
select test_reject('select get_operation_history_00453(p_page_size=>null)','AUDIT_FILTER_INVALID');
select test_reject('select get_operation_history_00453(p_page_size=>101)','AUDIT_FILTER_INVALID');
select test_reject($q$select get_operation_history_00453(p_source=>'fake')$q$,'AUDIT_FILTER_INVALID');
select test_reject($q$select get_operation_history_00453(p_from=>'2026-10-09',p_to=>'2026-10-08')$q$,'AUDIT_FILTER_INVALID');
select set_config('test.actor',test_id(4)::text,false);
select test_reject('select get_operation_history_00453()','AUDIT_PERMISSION_DENIED');
update profiles set role='manager' where id=test_id(4);
select test_assert((get_operation_history_00453()->>'total')::int=4,'branch manager cannot read other branch or unscoped history');
select test_reject('select get_operation_history_00453(p_branch_id=>test_id(99))','AUDIT_BRANCH_ACCESS_DENIED');
update profiles set is_active=false where id=test_id(1);
select set_config('test.actor',test_id(1)::text,false);
select test_reject('select get_operation_history_00453()','AUDIT_PERMISSION_DENIED');
select set_config('test.actor','',false);
select test_reject('select get_operation_history_00453()','AUDIT_PERMISSION_DENIED');
select test_assert(not has_function_privilege('anon','get_operation_history_00453(uuid,text,text,text,timestamptz,timestamptz,uuid,uuid,text,integer,integer)','EXECUTE'),'anonymous denied');
select test_assert(not has_function_privilege('authenticated','_audit_safe_json_00453(jsonb)','EXECUTE'),'internal helper private');
