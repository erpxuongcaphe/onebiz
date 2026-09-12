-- Read-only preflight for 00377. This never changes schema or business data.
with function_state as (
  select
    to_regprocedure(
      'public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'
    ) as public_rpc,
    to_regprocedure(
      'public._fnb_send_to_kitchen_impl_00303(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'
    ) as legacy_impl
), definitions as (
  select
    fs.*,
    case when fs.public_rpc is not null then pg_get_functiondef(fs.public_rpc) end as public_def,
    case when fs.legacy_impl is not null then pg_get_functiondef(fs.legacy_impl) end as legacy_def
  from function_state fs
)
select 'P1_CHUOI_GUI_BEP_SAN_SANG' as muc, 'DIEU_KIEN' as loai,
       public_rpc is not null and legacy_impl is not null as dat,
       jsonb_build_object(
         'public_rpc', public_rpc is not null,
         'legacy_impl', legacy_impl is not null,
         'giu_menu_chi_nhanh', position('_fnb_send_to_kitchen_impl_00353' in coalesce(public_def, '')) > 0
       ) as chi_tiet
from definitions
union all
select 'P2_IMPL_CO_GUARD_VARIANT_VA_TUY_CHON', 'DIEU_KIEN',
       position('PRODUCT_VARIANT_NOT_AVAILABLE' in coalesce(legacy_def, '')) > 0
       and position('REQUIRED_MODIFIER_MISSING' in coalesce(legacy_def, '')) > 0,
       jsonb_build_object('variant_guard', position('PRODUCT_VARIANT_NOT_AVAILABLE' in coalesce(legacy_def, '')) > 0,
                          'modifier_guard', position('REQUIRED_MODIFIER_MISSING' in coalesce(legacy_def, '')) > 0)
from definitions
union all
select 'P3_00377_CHUA_CAI', 'DIEU_KIEN',
       position('00377_VARIANT_SATISFIES_LEGACY_SIZE' in coalesce(legacy_def, '')) = 0,
       jsonb_build_object('ham_da_co', position('00377_VARIANT_SATISFIES_LEGACY_SIZE' in coalesce(legacy_def, '')) > 0)
from definitions;
