-- 00350 preflight (read-only) — OneBiz Coffee Demo only.
-- This query never changes data. Run it before 00350.

with target_tenant as (
  select '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid as tenant_id
), checks as (
  select
    'P1_RPC_NEN_DUNG_CHU_KY'::text as muc,
    'DIEU_KIEN'::text as loai,
    to_regprocedure('public.consume_bom_for_sale(uuid,uuid,uuid,numeric,uuid,uuid,text,jsonb,boolean,uuid)') is not null
      and to_regprocedure('public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)') is not null as dat,
    jsonb_build_object(
      'consume_bom', to_regprocedure('public.consume_bom_for_sale(uuid,uuid,uuid,numeric,uuid,uuid,text,jsonb,boolean,uuid)') is not null,
      'gui_bep', to_regprocedure('public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)') is not null
    ) as chi_tiet
  union all
  select
    'P2_CHUA_CO_LOP_00350', 'DIEU_KIEN',
    to_regclass('public.bom_modifier_option_quantities') is null
      and to_regprocedure('public._fnb_send_to_kitchen_impl_00330(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)') is null,
    jsonb_build_object(
      'bang_da_co', to_regclass('public.bom_modifier_option_quantities') is not null,
      'ham_noi_bo_da_co', to_regprocedure('public._fnb_send_to_kitchen_impl_00330(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)') is not null
    )
  union all
  select
    'P3_THONG_TIN_DUONG_LEGACY', 'THONG_TIN', true,
    jsonb_build_object(
      'dong_bom_co_scale_target', count(*),
      'nhom_lua_chon', coalesce(jsonb_agg(distinct g.name order by g.name) filter (where g.name is not null), '[]'::jsonb)
    )
  from public.bom_items bi
  join public.bom b on b.id = bi.bom_id
  left join public.modifier_groups g on g.id = bi.modifier_scale_target
  where b.tenant_id = (select tenant_id from target_tenant)
    and b.is_active
    and bi.modifier_scale_target is not null
)
select muc, loai, dat, chi_tiet from checks order by muc;
