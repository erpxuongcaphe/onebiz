-- Read-only preflight for 00364_atomic_price_tier_branch_scope.sql.
-- Run only after migration 00363 has been applied.

with overlapping_assignments as (
  select count(*)::int as groups
    from public.branch_price_tier_assignments a
    join public.branch_price_tier_assignments b
      on b.tenant_id = a.tenant_id
     and b.branch_id = a.branch_id
     and b.id > a.id
     and tstzrange(b.starts_at, b.ends_at, '[)')
         && tstzrange(a.starts_at, a.ends_at, '[)')
), current_counts as (
  select jsonb_build_object(
    'bang_gia_fnb', (
      select count(*) from public.price_tiers
       where is_active and scope in ('fnb', 'both')
    ),
    'dong_phan_cong', (select count(*) from public.branch_price_tier_assignments),
    'chi_nhanh_da_gan', (
      select count(distinct branch_id) from public.branch_price_tier_assignments
    ),
    'gia_nen_tang_theo_size', (
      select count(*) from public.product_platform_prices where variant_id is not null
    )
  ) as detail
)
select 'P1_00363_SAN_SANG'::text as muc,
       'DIEU_KIEN'::text as loai,
       (
         to_regclass('public.branch_price_tier_assignments') is not null
         and to_regprocedure('public.save_branch_price_tier_assignments_00363(uuid,jsonb,text)') is not null
         and to_regclass('public.product_platform_prices') is not null
       ) as dat,
       jsonb_build_object(
         'bang_phan_cong', to_regclass('public.branch_price_tier_assignments') is not null,
         'ham_luu', to_regprocedure('public.save_branch_price_tier_assignments_00363(uuid,jsonb,text)') is not null,
         'bang_gia_nen_tang', to_regclass('public.product_platform_prices') is not null
       ) as chi_tiet
union all
select 'P2_KHONG_CO_LICH_BANG_GIA_CHONG_NHAU', 'DIEU_KIEN', groups = 0,
       jsonb_build_object('so_cap_chong_nhau', groups)
  from overlapping_assignments
union all
select 'P3_00364_CHUA_CAI', 'DIEU_KIEN',
       to_regprocedure('public.delete_platform_price_targets_00364(jsonb)') is null,
       jsonb_build_object(
         'ham_xoa_gia_size_da_co',
         to_regprocedure('public.delete_platform_price_targets_00364(jsonb)') is not null
       )
union all
select 'I1_THONG_TIN_HIEN_CO', 'THONG_TIN', null::boolean, detail
  from current_counts;
