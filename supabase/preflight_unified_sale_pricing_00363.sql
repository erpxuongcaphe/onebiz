-- Read-only preflight for migration 00363_unified_sale_pricing.sql.
-- Run this whole file in Supabase SQL Editor before applying migration 00363.

with duplicate_tier_items as (
  select count(*)::int as groups
    from (
      select 1
        from public.price_tier_items
       group by price_tier_id, product_id, variant_id, min_qty
      having count(*) > 1
    ) duplicates
), current_counts as (
  select jsonb_build_object(
    'bang_gia', (select count(*) from public.price_tiers),
    'dong_gia', (select count(*) from public.price_tier_items),
    'gia_nen_tang', (select count(*) from public.product_platform_prices),
    'chi_nhanh_co_bang_gia', (select count(*) from public.branches where price_tier_id is not null),
    'quy_cach', (select count(*) from public.product_variants where is_active)
  ) as detail
)
select 'P1_NEN_GIA_SAN_SANG'::text as muc,
       'DIEU_KIEN'::text as loai,
       (
         to_regclass('public.price_tiers') is not null
         and to_regclass('public.price_tier_items') is not null
         and to_regclass('public.product_platform_prices') is not null
         and to_regclass('public.product_variants') is not null
         and to_regprocedure('public.user_has_permission(uuid,text)') is not null
       ) as dat,
       jsonb_build_object(
         'price_tiers', to_regclass('public.price_tiers') is not null,
         'price_tier_items', to_regclass('public.price_tier_items') is not null,
         'platform_prices', to_regclass('public.product_platform_prices') is not null,
         'variants', to_regclass('public.product_variants') is not null,
         'permission_helper', to_regprocedure('public.user_has_permission(uuid,text)') is not null
       ) as chi_tiet
union all
select 'P2_KHONG_TRUNG_DONG_BANG_GIA', 'DIEU_KIEN', groups = 0,
       jsonb_build_object('nhom_trung', groups)
  from duplicate_tier_items
union all
select 'P3_00363_CHUA_CAI', 'DIEU_KIEN',
       to_regprocedure('public.resolve_sale_price_00363(uuid,uuid,uuid,uuid,text,text,numeric,timestamptz)') is null,
       jsonb_build_object(
         'ham_da_co',
         to_regprocedure('public.resolve_sale_price_00363(uuid,uuid,uuid,uuid,text,text,numeric,timestamptz)') is not null
       )
union all
select 'I1_THONG_TIN_GIA_HIEN_CO', 'THONG_TIN', null::boolean, detail
  from current_counts;
