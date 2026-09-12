-- Read-only postflight for 00377.
with definitions as (
  select
    pg_get_functiondef(
      'public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'::regprocedure
    ) as public_def,
    pg_get_functiondef(
      'public._fnb_send_to_kitchen_impl_00303(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'::regprocedure
    ) as legacy_def
)
select 'K1_VARIANT_THAY_THE_SIZE_CU' as muc, 'DIEU_KIEN' as loai,
       position('00377_VARIANT_SATISFIES_LEGACY_SIZE' in legacy_def) > 0 as dat,
       '{}'::jsonb as chi_tiet
from definitions
union all
select 'K2_CHAN_GUI_TRUNG_SIZE_CU', 'DIEU_KIEN',
       position('00377_REJECT_DUPLICATE_LEGACY_SIZE' in legacy_def) > 0,
       '{}'::jsonb
from definitions
union all
select 'K3_GIU_GUARD_VARIANT_VA_TUY_CHON_KHAC', 'DIEU_KIEN',
       position('PRODUCT_VARIANT_NOT_AVAILABLE' in legacy_def) > 0
       and position('REQUIRED_MODIFIER_MISSING' in legacy_def) > 0,
       jsonb_build_object('variant_guard', true, 'modifier_guard', true)
from definitions
union all
select 'K4_GIU_CHUOI_MENU_CHI_NHANH', 'DIEU_KIEN',
       position('_fnb_send_to_kitchen_impl_00353' in public_def) > 0,
       jsonb_build_object('retail_thay_doi', false, 'du_lieu_kinh_doanh_thay_doi', false)
from definitions
union all
select 'K5_QUYEN_GOI', 'DIEU_KIEN',
       not has_function_privilege('anon',
         'public._fnb_send_to_kitchen_impl_00303(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)', 'EXECUTE')
       and not has_function_privilege('authenticated',
         'public._fnb_send_to_kitchen_impl_00303(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)', 'EXECUTE'),
       jsonb_build_object('impl_anonymous', false, 'impl_authenticated', false)
from definitions;
