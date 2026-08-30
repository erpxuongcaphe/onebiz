-- Read-only preflight for 00365.
with checks as (
  select 'P1_NEN_00357_SAN_SANG'::text as muc, 'DIEU_KIEN'::text as loai,
         to_regprocedure('public.save_fnb_size_setup_atomic(uuid,jsonb)') is not null as dat,
         jsonb_build_object(
           'size_rpc', to_regprocedure('public.save_fnb_size_setup_atomic(uuid,jsonb)') is not null,
           'modifier_rpc', to_regprocedure('public.save_product_modifier_groups_atomic(uuid,uuid[])') is not null
         ) as chi_tiet
  union all
  select 'P2_BANG_NEN_SAN_SANG', 'DIEU_KIEN',
         to_regclass('public.products') is not null
           and to_regclass('public.product_variants') is not null
           and to_regclass('public.bom') is not null,
         jsonb_build_object(
           'products', to_regclass('public.products') is not null,
           'variants', to_regclass('public.product_variants') is not null,
           'bom', to_regclass('public.bom') is not null
         )
  union all
  select 'P3_00365_CHUA_CAI', 'DIEU_KIEN',
         to_regprocedure('public.create_fnb_product_with_size_setup_atomic(jsonb,jsonb,uuid[])') is null,
         jsonb_build_object(
           'ham_da_co', to_regprocedure('public.create_fnb_product_with_size_setup_atomic(jsonb,jsonb,uuid[])') is not null
         )
  union all
  select 'I1_SAN_PHAM_FNB_GIA_0_KHONG_CO_SIZE', 'THONG_TIN', null::boolean,
         jsonb_build_object('so_sku', count(*))
    from public.products p
   where p.product_type = 'sku' and p.channel = 'fnb' and p.is_active
     and coalesce(p.sell_price, 0) <= 0
     and not exists (
       select 1 from public.product_variants pv
        where pv.product_id = p.id and pv.tenant_id = p.tenant_id and pv.is_active
     )
)
select muc, loai, dat, chi_tiet from checks order by muc;
