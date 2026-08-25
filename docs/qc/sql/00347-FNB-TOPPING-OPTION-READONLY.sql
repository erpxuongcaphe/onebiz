-- Read-only diagnosis for the one topping option that was configured with
-- both stock models. Scope is the OneBiz Coffee Demo tenant used for XTB.

with target as (
  select
    g.id as group_id,
    o.id as option_id,
    g.name as group_name,
    o.label as option_label,
    o.scale_factor,
    o.linked_product_id,
    p.code as product_code,
    p.name as product_name,
    p.unit as product_unit,
    p.product_type,
    p.channel,
    p.has_bom,
    p.bom_code
  from public.modifier_options o
  join public.modifier_groups g on g.id = o.group_id
  left join public.products p on p.id = o.linked_product_id
  where g.tenant_id = '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid
    and g.name = 'Topping'
    and o.label = 'Cốm xào - sốt cốm (800gram/túi)'
    and o.is_active
),
effective_products as (
  -- A product-level list overrides all category defaults for that product.
  select distinct
    p.id,
    p.code,
    p.name,
    c.name as category_name,
    'gan_truc_tiep'::text as source
  from target t
  join public.product_modifier_groups pmg
    on pmg.modifier_group_id = t.group_id
  join public.products p on p.id = pmg.product_id
  left join public.categories c on c.id = p.category_id
  where p.tenant_id = '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid

  union all

  select distinct
    p.id,
    p.code,
    p.name,
    c.name as category_name,
    'ke_thua_nhom_hang'::text as source
  from target t
  join public.category_modifier_groups cmg
    on cmg.modifier_group_id = t.group_id
  join public.products p on p.category_id = cmg.category_id
  left join public.categories c on c.id = p.category_id
  where p.tenant_id = '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid
    and not exists (
      select 1
        from public.product_modifier_groups pmg_any
       where pmg_any.product_id = p.id
    )
),
results as (
  select
    'T1_TOPPING_HIEN_TAI'::text as muc,
    'THONG_TIN'::text as loai,
    jsonb_build_object(
      'nhom', group_name,
      'lua_chon', option_label,
      'he_so_hien_tai', scale_factor,
      'ma_hang_lien_ket', product_code,
      'ten_hang_lien_ket', product_name,
      'don_vi_hang_lien_ket', product_unit,
      'loai_hang', product_type,
      'kenh_hang', channel,
      'co_bom', has_bom,
      'ma_bom', bom_code
    ) as chi_tiet
  from target

  union all

  select
    'T2_MON_DANG_DUNG_TOPPING',
    'THONG_TIN',
    jsonb_build_object(
      'so_mon', count(*),
      'danh_sach', coalesce(
        jsonb_agg(jsonb_build_object(
          'ma', code,
          'ten', name,
          'nhom_hang', category_name,
          'nguon_gan', source
        ) order by code),
        '[]'::jsonb
      )
    )
  from effective_products
)
select muc, loai, chi_tiet
  from results
 order by muc;
