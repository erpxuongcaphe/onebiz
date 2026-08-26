-- READ-ONLY: table access contracts used directly by the current web.
-- Only failed/missing contracts are returned. No business data is changed.

with required(relation_name, operation) as (
  values
    ('agent_executions', 'insert'),
    ('agent_executions', 'select'),
    ('agent_executions', 'update'),
    ('agent_tasks', 'delete'),
    ('agent_tasks', 'insert'),
    ('agent_tasks', 'select'),
    ('agent_tasks', 'update'),
    ('agents', 'delete'),
    ('agents', 'insert'),
    ('agents', 'select'),
    ('agents', 'update'),
    ('audit_log', 'insert'),
    ('audit_log', 'select'),
    ('bom', 'delete'),
    ('bom', 'insert'),
    ('bom', 'select'),
    ('bom', 'update'),
    ('bom_items', 'delete'),
    ('bom_items', 'insert'),
    ('bom_items', 'select'),
    ('bom_modifier_option_quantities', 'select'),
    ('branch_stock', 'select'),
    ('branches', 'insert'),
    ('branches', 'select'),
    ('cash_transactions', 'select'),
    ('categories', 'delete'),
    ('categories', 'insert'),
    ('categories', 'select'),
    ('categories', 'update'),
    ('category_modifier_groups', 'delete'),
    ('category_modifier_groups', 'insert'),
    ('category_modifier_groups', 'select'),
    ('conversation_messages', 'insert'),
    ('conversation_messages', 'select'),
    ('conversations', 'select'),
    ('conversations', 'update'),
    ('coupon_usages', 'select'),
    ('coupons', 'delete'),
    ('coupons', 'insert'),
    ('coupons', 'select'),
    ('coupons', 'update'),
    ('customer_groups', 'delete'),
    ('customer_groups', 'insert'),
    ('customer_groups', 'select'),
    ('customer_groups', 'update'),
    ('customer_saved_views', 'delete'),
    ('customer_saved_views', 'insert'),
    ('customer_saved_views', 'select'),
    ('customer_saved_views', 'update'),
    ('customers', 'insert'),
    ('customers', 'select'),
    ('customers', 'update'),
    ('delivery_partners', 'select'),
    ('delivery_partners', 'update'),
    ('disposal_exports', 'select'),
    ('favorites', 'select'),
    ('floor_plan_decorations', 'select'),
    ('floor_plan_zones', 'select'),
    ('floor-plans', 'select'),
    ('fnb_delivery_fee_tiers', 'delete'),
    ('fnb_delivery_fee_tiers', 'insert'),
    ('fnb_delivery_fee_tiers', 'select'),
    ('fnb_delivery_fee_tiers', 'update'),
    ('fnb_product_branch_menu_scopes', 'select'),
    ('input_invoices', 'select'),
    ('internal_exports', 'select'),
    ('internal_sale_items', 'select'),
    ('internal_sales', 'select'),
    ('inventory_check_items', 'select'),
    ('inventory_checks', 'select'),
    ('invoice_items', 'select'),
    ('invoices', 'select'),
    ('kitchen_order_items', 'select'),
    ('kitchen_orders', 'select'),
    ('kitchen_stations', 'insert'),
    ('kitchen_stations', 'select'),
    ('kitchen_stations', 'update'),
    ('kpi_breakdowns', 'delete'),
    ('kpi_breakdowns', 'insert'),
    ('kpi_breakdowns', 'select'),
    ('kpi_breakdowns', 'update'),
    ('loyalty_settings', 'insert'),
    ('loyalty_settings', 'select'),
    ('loyalty_settings', 'update'),
    ('loyalty_tiers', 'delete'),
    ('loyalty_tiers', 'insert'),
    ('loyalty_tiers', 'select'),
    ('loyalty_tiers', 'update'),
    ('loyalty_transactions', 'select'),
    ('mkt_audit_access_tokens', 'select'),
    ('mkt_audit_actors', 'insert'),
    ('mkt_audit_actors', 'select'),
    ('mkt_audit_results', 'insert'),
    ('mkt_audit_results', 'select'),
    ('mkt_audit_results', 'update'),
    ('mkt_audit_runs', 'insert'),
    ('mkt_audit_runs', 'select'),
    ('mkt_audit_runs', 'update'),
    ('mkt_audit_sandboxes', 'insert'),
    ('mkt_audit_sandboxes', 'select'),
    ('mkt_campaign_plans', 'select'),
    ('mkt_campaign_readiness_items', 'select'),
    ('mkt_campaigns', 'select'),
    ('mkt_channel_plan_items', 'select'),
    ('mkt_channel_plan_stages', 'select'),
    ('mkt_channel_plan_versions', 'select'),
    ('mkt_channel_plans', 'select'),
    ('mkt_channel_work_packages', 'select'),
    ('mkt_content_items', 'select'),
    ('mkt_content_pillar_angles', 'select'),
    ('mkt_content_pillars', 'select'),
    ('mkt_content_reviews', 'select'),
    ('mkt_content_versions', 'select'),
    ('mkt_documents', 'select'),
    ('mkt_media_assets', 'select'),
    ('mkt_outbox_events', 'update'),
    ('mkt_plan_kpi_entries', 'select'),
    ('mkt_plan_kpis', 'select'),
    ('mkt_plan_progress_reports', 'select'),
    ('mkt_security_events', 'insert'),
    ('mkt_tasks', 'select'),
    ('mkt_telegram_accounts', 'select'),
    ('modifier_groups', 'insert'),
    ('modifier_groups', 'select'),
    ('modifier_groups', 'update'),
    ('modifier_options', 'insert'),
    ('modifier_options', 'select'),
    ('modifier_options', 'update'),
    ('notifications', 'delete'),
    ('notifications', 'insert'),
    ('notifications', 'select'),
    ('notifications', 'update'),
    ('online_orders', 'select'),
    ('online_orders', 'update'),
    ('pending_shifts_view', 'select'),
    ('pipeline_items', 'insert'),
    ('pipeline_items', 'select'),
    ('pipeline_stages', 'select'),
    ('pipelines', 'select'),
    ('price_tier_items', 'delete'),
    ('price_tier_items', 'insert'),
    ('price_tier_items', 'select'),
    ('price_tier_items', 'update'),
    ('price_tiers', 'delete'),
    ('price_tiers', 'insert'),
    ('price_tiers', 'select'),
    ('price_tiers', 'update'),
    ('print_templates', 'insert'),
    ('print_templates', 'select'),
    ('print_templates', 'update'),
    ('product_lots', 'insert'),
    ('product_lots', 'select'),
    ('product_modifier_groups', 'delete'),
    ('product_modifier_groups', 'insert'),
    ('product_modifier_groups', 'select'),
    ('product_platform_prices', 'select'),
    ('product_variants', 'insert'),
    ('product_variants', 'select'),
    ('product_variants', 'update'),
    ('production_order_materials', 'select'),
    ('production_orders', 'select'),
    ('products', 'insert'),
    ('products', 'select'),
    ('products', 'update'),
    ('profiles', 'insert'),
    ('profiles', 'select'),
    ('profiles', 'update'),
    ('promotion_settings', 'insert'),
    ('promotion_settings', 'select'),
    ('promotion_settings', 'update'),
    ('promotions', 'delete'),
    ('promotions', 'insert'),
    ('promotions', 'select'),
    ('promotions', 'update'),
    ('purchase_order_items', 'select'),
    ('purchase_orders', 'select'),
    ('restaurant_tables', 'select'),
    ('return_items', 'select'),
    ('role_permissions', 'select'),
    ('roles', 'select'),
    ('sales_order_items', 'select'),
    ('sales_orders', 'select'),
    ('sales_returns', 'select'),
    ('shifts', 'select'),
    ('shipping_orders', 'select'),
    ('stock_movements', 'select'),
    ('stock_transfer_items', 'select'),
    ('stock_transfers', 'select'),
    ('supplier_return_items', 'select'),
    ('supplier_returns', 'select'),
    ('suppliers', 'insert'),
    ('suppliers', 'select'),
    ('suppliers', 'update'),
    ('tenant_settings', 'select'),
    ('tenants', 'delete'),
    ('tenants', 'insert'),
    ('tenants', 'select'),
    ('uom_conversions', 'insert'),
    ('uom_conversions', 'select'),
    ('uom_conversions', 'update'),
    ('user_permission_overrides', 'delete'),
    ('user_permission_overrides', 'insert'),
    ('user_permission_overrides', 'select'),
    ('user_permission_overrides', 'update')
),
checked as (
  select
    r.relation_name,
    r.operation,
    c.oid,
    c.relkind,
    c.relrowsecurity,
    case r.operation
      when 'select' then 'SELECT'
      when 'insert' then 'INSERT'
      when 'update' then 'UPDATE'
      when 'delete' then 'DELETE'
    end as privilege_name,
    case r.operation
      when 'select' then 'r'
      when 'insert' then 'a'
      when 'update' then 'w'
      when 'delete' then 'd'
    end as policy_command
  from required r
  left join pg_class c
    on c.relnamespace = 'public'::regnamespace
   and c.relname = r.relation_name
)
select
  relation_name,
  operation,
  oid is not null as relation_exists,
  coalesce(has_table_privilege('authenticated', oid, privilege_name), false)
    as authenticated_grant_ok,
  case
    when oid is null then false
    when relkind in ('v', 'm') then true
    when not relrowsecurity then true
    else exists (
      select 1
      from pg_policy p
      where p.polrelid = checked.oid
        and p.polcmd::text in (checked.policy_command, '*')
        and (
          0::oid = any(p.polroles)
          or (select oid from pg_roles where rolname = 'authenticated') = any(p.polroles)
        )
    )
  end as applicable_rls_policy_ok,
  coalesce(relrowsecurity, false) as rls_enabled
from checked
where oid is null
   or not coalesce(has_table_privilege('authenticated', oid, privilege_name), false)
   or (
     relkind not in ('v', 'm')
     and relrowsecurity
     and not exists (
       select 1
       from pg_policy p
       where p.polrelid = checked.oid
         and p.polcmd::text in (checked.policy_command, '*')
         and (
           0::oid = any(p.polroles)
           or (select oid from pg_roles where rolname = 'authenticated') = any(p.polroles)
         )
     )
   )
order by relation_name, operation;

