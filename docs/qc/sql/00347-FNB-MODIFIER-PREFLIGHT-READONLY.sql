-- 00347 preflight (read-only)
-- No placeholder values. Safe to run repeatedly in Supabase SQL Editor.

with results as (
  select
    'P1_SCHEMA_SAN_SANG'::text as muc,
    'DIEU_KIEN'::text as loai,
    exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'modifier_options'
         and column_name in (
           'group_id', 'scale_factor', 'linked_product_id',
           'is_default', 'is_active', 'updated_at'
         )
       group by table_schema, table_name
      having count(*) = 6
    )
    and exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'modifier_groups'
         and column_name in ('id', 'tenant_id', 'rule', 'is_active')
       group by table_schema, table_name
      having count(*) = 4
    ) as dat,
    '{}'::jsonb as chi_tiet

  union all

  select
    'P2_KHONG_TRU_KHO_HAI_LAN',
    'DIEU_KIEN',
    not exists (
      select 1
        from public.modifier_options o
       where o.is_active
         and o.scale_factor is not null
         and o.linked_product_id is not null
    ),
    jsonb_build_object(
      'so_lua_chon_loi', (
        select count(*)
          from public.modifier_options o
         where o.is_active
           and o.scale_factor is not null
           and o.linked_product_id is not null
      ),
      'danh_sach', coalesce((
        select jsonb_agg(jsonb_build_object(
          'nhom', x.group_name,
          'lua_chon', x.option_label,
          'he_so', x.scale_factor,
          'ma_hang_lien_ket', x.product_code,
          'ten_hang_lien_ket', x.product_name,
          'la_mac_dinh', x.is_default
        ) order by x.group_name, x.option_label)
          from (
            select
              g.name as group_name,
              o.label as option_label,
              o.scale_factor,
              o.is_default,
              p.code as product_code,
              p.name as product_name
            from public.modifier_options o
            join public.modifier_groups g on g.id = o.group_id
            left join public.products p on p.id = o.linked_product_id
            where o.is_active
              and o.scale_factor is not null
              and o.linked_product_id is not null
          ) x
      ), '[]'::jsonb)
    )

  union all

  select
    'P3_MOI_NHOM_CHON_MOT_CO_MOT_MAC_DINH',
    'DIEU_KIEN',
    not exists (
      select 1
        from public.modifier_groups g
        join public.modifier_options o
          on o.group_id = g.id
         and o.is_active
         and o.is_default
       where g.is_active
         and g.rule in ('single', 'single_required')
       group by g.id
      having count(*) > 1
    ),
    jsonb_build_object(
      'nhom_loi', coalesce((
        select jsonb_agg(jsonb_build_object('ten', x.name, 'so_mac_dinh', x.default_count))
          from (
            select g.name, count(*) as default_count
              from public.modifier_groups g
              join public.modifier_options o
                on o.group_id = g.id
               and o.is_active
               and o.is_default
             where g.is_active
               and g.rule in ('single', 'single_required')
             group by g.id, g.name
            having count(*) > 1
          ) x
      ), '[]'::jsonb)
    )

  union all

  select
    'P4_THONG_TIN_XOA_MEM',
    'THONG_TIN',
    null::boolean,
    jsonb_build_object(
      'lua_chon_dang_bat', (select count(*) from public.modifier_options where is_active),
      'lua_chon_da_xoa_mem', (select count(*) from public.modifier_options where not is_active)
    )
)
select muc, loai, dat, chi_tiet
  from results
 order by muc;
