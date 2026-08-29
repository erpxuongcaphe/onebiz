-- 00361 read-only postflight. Expected: all DIEU_KIEN rows are true.

with sugar_options as (
  select
    g.id as group_id,
    g.name as group_name,
    o.id as option_id,
    o.label,
    o.is_active,
    o.is_default,
    o.scale_factor,
    o.linked_product_id,
    p.code as linked_product_code,
    p.name as linked_product_name
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
      where is_active and scale_factor is not null and linked_product_id is not null
    ) as dat,
    jsonb_build_object(
      'lua_chon_loi', coalesce((
        select jsonb_agg(jsonb_build_object(
          'nhom', group_name,
          'lua_chon', label,
          'scale_factor', scale_factor,
          'ma_hang_link', linked_product_code,
          'ten_hang_link', linked_product_name
        ) order by label)
        from sugar_options
        where is_active and scale_factor is not null and linked_product_id is not null
      ), '[]'::jsonb)
    ) as chi_tiet

  union all

  select
    'K2_HE_SO_FALLBACK_DUNG_NGHIA',
    'DIEU_KIEN',
    not exists (
      select 1
      from sugar_options
      where is_active
        and btrim(label) in ('Không đường', '80%', '100%', '120%')
        and scale_factor is distinct from case btrim(label)
          when 'Không đường' then 0::numeric
          when '80%' then 0.8::numeric
          when '100%' then 1::numeric
          when '120%' then 1.2::numeric
        end
    ),
    jsonb_build_object(
      'cac_muc', coalesce((
        select jsonb_agg(jsonb_build_object(
          'muc', label,
          'he_so', scale_factor
        ) order by scale_factor, label)
        from sugar_options
        where is_active and btrim(label) in ('Không đường', '80%', '100%', '120%')
      ), '[]'::jsonb)
    )

  union all

  select
    'K3_100_PHAN_TRAM_LA_MAC_DINH_DUY_NHAT',
    'DIEU_KIEN',
    not exists (
      select 1
      from (
        select group_id
        from sugar_options
        where is_active
        group by group_id
        having count(*) filter (where is_default and btrim(label) = '100%') <> 1
           or count(*) filter (where is_default) <> 1
      ) invalid_groups
    ),
    jsonb_build_object(
      'mac_dinh', coalesce((
        select jsonb_agg(jsonb_build_object('nhom', group_name, 'lua_chon', label))
        from sugar_options
        where is_active and is_default
      ), '[]'::jsonb)
    )

  union all

  select
    'I1_DINH_LUONG_CHINH_XAC_KHONG_BI_SUA',
    'THONG_TIN',
    null::boolean,
    jsonb_build_object(
      'ghi_chu', '00361 chi sua modifier_options cua nhom Muc duong chung; khong update bom_items hay bom_modifier_option_quantities.'
    )
)
select muc, loai, dat, chi_tiet
from checks
order by muc;
