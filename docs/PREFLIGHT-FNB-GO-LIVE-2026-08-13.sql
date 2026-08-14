-- Hậu kiểm CHỈ ĐỌC trước khi vận hành POS FnB.
-- File này không tạo, sửa hoặc xóa dữ liệu.
-- Chạy toàn bộ file và đọc cột ket_luan + viec_can_lam_tiep.

with function_defs as (
  select
    coalesce(pg_get_functiondef(to_regprocedure(
      'public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'
    )), '') as send_to_kitchen,
    coalesce(pg_get_functiondef(to_regprocedure(
      'public._fnb_complete_payment_impl_00230(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)'
    )), '') as complete_payment,
    coalesce(pg_get_functiondef(to_regprocedure(
      'public.get_active_bom_for_branch(uuid,uuid,uuid)'
    )), '') as bom_lookup,
    coalesce(pg_get_functiondef(to_regprocedure(
      'public.consume_bom_for_sale(uuid,uuid,uuid,numeric,uuid,uuid,text,jsonb,boolean,uuid)'
    )), '') as bom_consume,
    coalesce(pg_get_functiondef(to_regprocedure(
      'public.restore_bom_for_return(uuid,uuid,uuid,numeric,uuid,uuid,text,uuid)'
    )), '') as bom_restore
), modifier_schema as (
  select
    count(*) filter (where column_name = 'min_select') = 1 as has_min_select,
    count(*) filter (where column_name = 'max_select') = 1 as has_max_select
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'modifier_groups'
    and column_name in ('min_select', 'max_select')
), configuration as (
  select
    count(*) filter (
      where p.deleted_at is null
        and p.is_active = true
        and p.product_type = 'sku'
        and p.channel = 'fnb'
        and p.code ilike 'SKU-TPP%'
    ) as topping_total,
    count(*) filter (
      where p.deleted_at is null
        and p.is_active = true
        and p.product_type = 'sku'
        and p.channel = 'fnb'
        and p.code ilike 'SKU-TPP%'
        and p.sell_price > 0
        and exists (
          select 1
          from public.bom b
          where b.is_active = true
            and (
              b.product_id = p.id
              or (p.bom_code is not null and b.code = p.bom_code)
            )
        )
    ) as topping_ready
  from public.products p
), modifier_configuration as (
  select
    count(distinct mg.id) filter (
      where mg.is_active = true
        and mg.name = 'Topping'
    ) as legacy_topping_groups_active,
    count(*) filter (
      where mg.is_active = true
        and mg.name = 'Mức đường'
        and mo.is_active = true
        and mo.scale_factor is not null
        and mo.linked_product_id is not null
    ) as sugar_double_stock_options,
    count(*) filter (
      where mg.is_active = true
        and mg.name = 'Mức đường'
        and mo.is_active = true
        and mo.is_default = true
    ) as sugar_defaults
  from public.modifier_groups mg
  left join public.modifier_options mo on mo.group_id = mg.id
), checks as (
  select
    position('00303' in f.send_to_kitchen) > 0 as topping_compat_00303_ok,
    position('GIA_TOPPING_SERVER_00304' in f.complete_payment) > 0
      as topping_server_price_00304_ok,
    m.has_min_select
      and m.has_max_select
      and to_regprocedure(
        'public.enforce_fnb_modifier_multi_limits_00318()'
      ) is not null as modifier_limits_00318_ok,
    f.bom_lookup <> ''
      and position('p_variant_id' in f.bom_lookup) > 0
      as variant_bom_lookup_ok,
    f.bom_consume <> ''
      and position('p_variant_id' in f.bom_consume) > 0
      and position('get_active_bom_for_branch' in f.bom_consume) > 0
      as variant_bom_consume_ok,
    f.complete_payment <> ''
      and position('r.variant_id' in f.complete_payment) > 0
      and position('consume_bom_for_sale' in f.complete_payment) > 0
      as fnb_checkout_passes_variant_ok,
    f.bom_restore <> ''
      and position('p_variant_id' in f.bom_restore) > 0
      and position('get_active_bom_for_branch' in f.bom_restore) > 0
      as fnb_return_restores_variant_ok,
    c.topping_total,
    c.topping_ready,
    mc.legacy_topping_groups_active,
    mc.sugar_double_stock_options,
    mc.sugar_defaults
  from function_defs f
  cross join modifier_schema m
  cross join configuration c
  cross join modifier_configuration mc
)
select
  topping_compat_00303_ok,
  topping_server_price_00304_ok,
  modifier_limits_00318_ok,
  variant_bom_lookup_ok,
  variant_bom_consume_ok,
  fnb_checkout_passes_variant_ok,
  fnb_return_restores_variant_ok,
  topping_total as topping_sku_total,
  topping_ready as topping_sku_ready,
  legacy_topping_groups_active,
  sugar_double_stock_options,
  sugar_defaults,
  case
    when not variant_bom_lookup_ok
      or not variant_bom_consume_ok
      or not fnb_checkout_passes_variant_ok
      or not fnb_return_restores_variant_ok
      then 'DỪNG - công thức theo Size chưa đủ mắt xích'
    when not topping_compat_00303_ok
      then 'DỪNG - chưa có lớp tương thích topping 00303'
    when not topping_server_price_00304_ok
      then 'DỪNG - giá topping chưa được máy chủ kiểm soát'
    when not modifier_limits_00318_ok
      then 'DỪNG - giới hạn lựa chọn món chưa được bảo vệ'
    when topping_total = 0 or topping_ready < topping_total
      then 'CHƯA SẴN SÀNG - topping chưa đủ giá và công thức'
    when legacy_topping_groups_active > 0
      then 'CHƯA SẴN SÀNG - còn nhóm Topping cũ đang bật'
    when sugar_double_stock_options > 0 or sugar_defaults <> 1
      then 'CHƯA SẴN SÀNG - cấu hình Mức đường chưa sạch'
    else 'ĐẠT - sẵn sàng kiểm khói FnB'
  end as ket_luan,
  case
    when not variant_bom_lookup_ok
      or not variant_bom_consume_ok
      or not fnb_checkout_passes_variant_ok
      or not fnb_return_restores_variant_ok
      then 'Không bật FnB. Đối chiếu và cài lại 00147, 00148, 00230 hoặc 00244 bị thiếu.'
    when not topping_compat_00303_ok
      then 'Không bật FnB. Chạy migration 00303 rồi chạy lại hậu kiểm.'
    when not topping_server_price_00304_ok
      then 'Không bật topping SKU. Chạy migration 00304 rồi chạy lại hậu kiểm.'
    when not modifier_limits_00318_ok
      then 'Không bật FnB. Chạy migration 00318 rồi chạy lại hậu kiểm.'
    when topping_total = 0
      then 'Nhập SKU topping theo phần trước khi bật tính năng.'
    when topping_ready < topping_total
      then format(
        'Còn %s/%s SKU topping thiếu giá bán hoặc BOM đang bật.',
        topping_total - topping_ready,
        topping_total
      )
    when legacy_topping_groups_active > 0
      then 'Tắt nhóm tùy chọn Topping cũ sau khi đã kiểm SKU topping mới.'
    when sugar_double_stock_options > 0
      then 'Gỡ liên kết sản phẩm khỏi lựa chọn Mức đường để tránh trừ kho hai lần.'
    when sugar_defaults <> 1
      then 'Mức đường phải có đúng một lựa chọn mặc định; nên chọn 100%.'
    else 'Kiểm một đơn thử: chọn Size và topping, gửi bếp, thanh toán, trả hàng; đối chiếu tồn và phiếu bếp.'
  end as viec_can_lam_tiep
from checks;
