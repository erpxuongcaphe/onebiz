-- 00362 read-only postflight. Expected: K1 and K2 are true.

with sugar_options as (
  select
    g.id as group_id,
    g.name as group_name,
    o.label,
    o.is_active,
    o.is_default,
    o.scale_factor,
    o.linked_product_id,
    p.code as linked_product_code
  from public.modifier_groups g
  join public.modifier_options o on o.group_id = g.id
  left join public.products p on p.id = o.linked_product_id
  where lower(btrim(g.name)) = lower('Mức đường')
), checks as (
  select
    'K1_KHONG_TRU_KHO_HAI_LAN'::text as muc,
    'DIEU_KIEN'::text as loai,
    not exists (
      select 1 from sugar_options
      where is_active
        and scale_factor is not null
        and linked_product_id is not null
    ) as dat,
    jsonb_build_object(
      'so_lua_chon_loi', (
        select count(*) from sugar_options
        where is_active
          and scale_factor is not null
          and linked_product_id is not null
      )
    ) as chi_tiet

  union all

  select
    'K2_MOI_NHOM_CO_DUNG_MOT_MAC_DINH',
    'DIEU_KIEN',
    not exists (
      select 1
      from sugar_options
      where is_active
      group by group_id
      having count(*) filter (where is_default) <> 1
    ),
    jsonb_build_object(
      'nhom_loi', coalesce((
        select jsonb_agg(jsonb_build_object(
          'nhom', group_name,
          'so_mac_dinh', so_mac_dinh
        ))
        from (
          select group_id, min(group_name) as group_name,
                 count(*) filter (where is_default) as so_mac_dinh
          from sugar_options
          where is_active
          group by group_id
          having count(*) filter (where is_default) <> 1
        ) invalid_groups
      ), '[]'::jsonb)
    )

  union all

  select
    'I1_NHAN_HIEN_THI_DOC_LAP',
    'THONG_TIN',
    null::boolean,
    jsonb_build_object(
      'lua_chon', coalesce((
        select jsonb_agg(jsonb_build_object(
          'ten_hien_thi', label,
          'mac_dinh', is_default,
          'he_so_fallback', scale_factor,
          'ma_hang_tru_thang', linked_product_code
        ) order by label)
        from sugar_options
        where is_active
      ), '[]'::jsonb),
      'ghi_chu', 'Ten hien thi co the doi thanh Binh thuong, It ngot...; dinh luong va mac dinh khong duoc suy tu ten.'
    )
)
select muc, loai, dat, chi_tiet
from checks
order by muc;
