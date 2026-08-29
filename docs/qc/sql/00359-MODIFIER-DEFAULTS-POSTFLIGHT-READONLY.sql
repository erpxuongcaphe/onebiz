-- READ ONLY: verify that every active single-choice modifier group has at
-- most one active default after 00359.
select
  'K1_KHONG_CON_NHOM_HAI_MAC_DINH' as muc,
  'DIEU_KIEN' as loai,
  not exists (
    select 1
    from public.modifier_groups g
    join public.modifier_options o on o.group_id = g.id
    where g.rule in ('single', 'single_required')
      and g.is_active
      and o.is_active
      and o.is_default
    group by g.id
    having count(*) > 1
  ) as dat,
  jsonb_build_object(
    'so_nhom_loi', (
      select count(*)
      from (
        select g.id
        from public.modifier_groups g
        join public.modifier_options o on o.group_id = g.id
        where g.rule in ('single', 'single_required')
          and g.is_active
          and o.is_active
          and o.is_default
        group by g.id
        having count(*) > 1
      ) invalid_groups
    )
  ) as chi_tiet;
