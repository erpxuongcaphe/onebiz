-- READ ONLY: default integrity plus every remaining legacy stock-effect issue.
-- K1 must be true after 00360. K2-K4 expose unsafe product/modifier data that
-- needs a deliberate business choice; this script never changes those rows.

select
  'K1_KHONG_CON_NHOM_HAI_MAC_DINH' as muc,
  'DIEU_KIEN' as loai,
  not exists (
    select 1
    from public.modifier_groups g
    join public.modifier_options o on o.group_id = g.id
    where g.rule in ('single', 'single_required')
      and g.is_active and o.is_active and o.is_default
    group by g.id
    having count(*) > 1
  ) as dat,
  jsonb_build_object(
    'nhom_loi', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nhom', x.group_name,
        'so_mac_dinh', x.default_count
      ) order by x.group_name)
      from (
        select g.name as group_name, count(*) as default_count
        from public.modifier_groups g
        join public.modifier_options o on o.group_id = g.id
        where g.rule in ('single', 'single_required')
          and g.is_active and o.is_active and o.is_default
        group by g.id, g.name
        having count(*) > 1
      ) x
    ), '[]'::jsonb)
  ) as chi_tiet

union all

select
  'K2_KHONG_TRU_KHO_HAI_LAN' as muc,
  'DIEU_KIEN' as loai,
  count(*) = 0 as dat,
  jsonb_build_object(
    'so_lua_chon_loi', count(*),
    'lua_chon_loi', coalesce(jsonb_agg(jsonb_build_object(
      'nhom', g.name,
      'lua_chon', o.label,
      'scale_factor', o.scale_factor,
      'ma_hang_link', p.code,
      'ten_hang_link', p.name
    ) order by g.name, o.sort_order) filter (where o.id is not null), '[]'::jsonb)
  ) as chi_tiet
from public.modifier_options o
join public.modifier_groups g on g.id = o.group_id
left join public.products p on p.id = o.linked_product_id
where o.is_active
  and o.scale_factor is not null
  and o.linked_product_id is not null

union all

select
  'K3_KHONG_CO_HE_SO_AM' as muc,
  'DIEU_KIEN' as loai,
  count(*) = 0 as dat,
  jsonb_build_object('so_lua_chon_loi', count(*)) as chi_tiet
from public.modifier_options o
where o.is_active and o.scale_factor < 0

union all

select
  'K4_LINK_HANG_CUNG_CONG_TY' as muc,
  'DIEU_KIEN' as loai,
  count(*) = 0 as dat,
  jsonb_build_object('so_link_loi', count(*)) as chi_tiet
from public.modifier_options o
join public.modifier_groups g on g.id = o.group_id
left join public.products p on p.id = o.linked_product_id
where o.is_active
  and o.linked_product_id is not null
  and (p.id is null or p.tenant_id is distinct from g.tenant_id);
