-- 00347 postflight (read-only)
-- Run after 00347, then correct every DIEU_KIEN row that is false through
-- Hàng hóa > Tùy chọn món FnB. This query never changes data.

with routine_checks as (
  select
    to_regprocedure('public.enforce_modifier_option_integrity_00347()') as option_routine,
    to_regprocedure('public.enforce_modifier_group_integrity_00347()') as group_routine
),
results as (
  select
    'K1_GUARD_DA_CAI'::text as muc,
    'DIEU_KIEN'::text as loai,
    (
      option_routine is not null
      and group_routine is not null
      and exists (
        select 1 from pg_trigger
         where tgname = 'trg_enforce_modifier_option_integrity_00347'
           and not tgisinternal
      )
      and exists (
        select 1 from pg_trigger
         where tgname = 'trg_enforce_modifier_group_integrity_00347'
           and not tgisinternal
      )
    ) as dat,
    jsonb_build_object(
      'option_guard', option_routine is not null,
      'group_guard', group_routine is not null
    ) as chi_tiet
  from routine_checks

  union all

  select
    'K2_GUARD_KHONG_MO_TRINH_DUYET',
    'DIEU_KIEN',
    not has_function_privilege('anon', option_routine, 'execute')
      and not has_function_privilege('authenticated', option_routine, 'execute')
      and not has_function_privilege('service_role', option_routine, 'execute')
      and not has_function_privilege('anon', group_routine, 'execute')
      and not has_function_privilege('authenticated', group_routine, 'execute')
      and not has_function_privilege('service_role', group_routine, 'execute'),
    jsonb_build_object(
      'option_anon', has_function_privilege('anon', option_routine, 'execute'),
      'option_authenticated', has_function_privilege('authenticated', option_routine, 'execute'),
      'option_service_role', has_function_privilege('service_role', option_routine, 'execute'),
      'group_anon', has_function_privilege('anon', group_routine, 'execute'),
      'group_authenticated', has_function_privilege('authenticated', group_routine, 'execute'),
      'group_service_role', has_function_privilege('service_role', group_routine, 'execute')
    )
  from routine_checks

  union all

  select
    'K3_KHONG_TRU_KHO_HAI_LAN',
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
    'K4_MOI_NHOM_CHON_MOT_CO_MOT_MAC_DINH',
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
    'K5_LINK_HANG_CUNG_CONG_TY',
    'DIEU_KIEN',
    not exists (
      select 1
        from public.modifier_options o
        join public.modifier_groups g on g.id = o.group_id
        join public.products p on p.id = o.linked_product_id
       where o.linked_product_id is not null
         and p.tenant_id <> g.tenant_id
    ),
    jsonb_build_object(
      'so_lien_ket_sai_cong_ty', (
        select count(*)
          from public.modifier_options o
          join public.modifier_groups g on g.id = o.group_id
          join public.products p on p.id = o.linked_product_id
         where o.linked_product_id is not null
           and p.tenant_id <> g.tenant_id
      )
    )
)
select muc, loai, dat, chi_tiet
  from results
 order by muc;
