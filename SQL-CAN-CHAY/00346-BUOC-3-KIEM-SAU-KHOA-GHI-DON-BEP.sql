-- 00346 BUOC 3 - CHI DOC. Khong ghi, khong sua du lieu.
-- Tat ca dong DIEU_KIEN phai dat = true truoc khi nghiem thu Preview/merge.

with internal_rpcs(signature) as (
  values
    ('public._fnb_cancel_unpaid_order_impl_00066(uuid,text,text,uuid,uuid)'),
    ('public._fnb_void_invoice_impl_00329(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)'),
    ('public._fnb_complete_payment_impl_00343(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)')
), internal_state as (
  select
    r.signature,
    p.oid,
    p.prosecdef as security_definer,
    pg_get_userbyid(p.proowner) as chu_so_huu,
    coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as authenticated_goi_duoc,
    coalesce(has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_goi_duoc
  from internal_rpcs r
  left join pg_proc p on p.oid = to_regprocedure(r.signature)
), required_rpcs(signature) as (
  values
    ('public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'),
    ('public.fnb_update_kitchen_item_status_v2(uuid,text)'),
    ('public.fnb_update_kitchen_order_status_v2(uuid,text)'),
    ('public.fnb_cancel_unpaid_order_atomic(uuid,text,text,uuid,uuid)'),
    ('public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)'),
    ('public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)')
), rpc_state as (
  select
    r.signature,
    p.oid,
    p.prosecdef as security_definer,
    pg_get_userbyid(p.proowner) as chu_so_huu,
    coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as authenticated_goi_duoc,
    coalesce(has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_goi_duoc
  from required_rpcs r
  left join pg_proc p on p.oid = to_regprocedure(r.signature)
), table_matrix as (
  select
    v.table_name,
    r.role_name,
    a.action_name,
    has_table_privilege(r.role_name, v.table_name, a.action_name) as goi_duoc
  from (values
    ('public.kitchen_orders'),
    ('public.kitchen_order_items'),
    ('public.pos_exception_events')
  ) as v(table_name)
  cross join (values ('anon'), ('authenticated')) as r(role_name)
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as a(action_name)
)
select
  'K0_HAM_NOI_BO_DA_KHOA' as muc,
  'DIEU_KIEN' as loai,
  bool_and(
    oid is not null
    and security_definer
    and chu_so_huu = 'postgres'
    and not authenticated_goi_duoc
    and not anon_goi_duoc
  ) as dat,
  jsonb_agg(jsonb_build_object(
    'chu_ky', signature,
    'co_mat', oid is not null,
    'security_definer', security_definer,
    'chu_so_huu', chu_so_huu,
    'authenticated_goi_duoc', authenticated_goi_duoc,
    'anon_goi_duoc', anon_goi_duoc
  ) order by signature) as chi_tiet
from internal_state

union all

select
  'K1_RPC_THAY_THE_CON_AN_TOAN' as muc,
  'DIEU_KIEN' as loai,
  bool_and(
    oid is not null
    and security_definer
    and chu_so_huu = 'postgres'
    and authenticated_goi_duoc
    and not anon_goi_duoc
  ) as dat,
  jsonb_agg(jsonb_build_object(
    'chu_ky', signature,
    'co_mat', oid is not null,
    'security_definer', security_definer,
    'chu_so_huu', chu_so_huu,
    'authenticated_goi_duoc', authenticated_goi_duoc,
    'anon_goi_duoc', anon_goi_duoc
  ) order by signature) as chi_tiet
from rpc_state

union all

select
  'K2_KHOA_GHI_TRUC_TIEP' as muc,
  'DIEU_KIEN' as loai,
  bool_and(not goi_duoc) as dat,
  jsonb_agg(jsonb_build_object(
    'bang', table_name,
    'vai_tro', role_name,
    'thao_tac', action_name,
    'goi_duoc', goi_duoc
  ) order by table_name, role_name, action_name) as chi_tiet
from table_matrix;
