-- ============================================================
-- QC OneBiz - RLS preflight CHI DOC
-- ============================================================
-- Muc dich:
--   1. Xac nhan 00241 da tung duoc ap dung hay chua.
--   2. Doc policy song, quyen bang va cot tenant_id tren DB that.
--   3. Khong INSERT/UPDATE/DELETE, khong ALTER, khong tao policy.
--
-- Cach dung:
--   - Chay toan bo file trong Supabase SQL Editor.
--   - Gui lai ca 4 bang ket qua cho Codex.
-- ============================================================

-- 1) Lich su migration lien quan.
select
  version,
  name,
  statements is not null as has_statements
from supabase_migrations.schema_migrations
where version in ('00239', '00240', '00241', '239', '240', '241')
order by version;

-- 2) Trang thai RLS, owner va cot tenant_id cua cac bang can doi chieu.
with targets(table_name, scope_kind, parent_table) as (
  values
    ('audit_log', 'tenant', null),
    ('bom_modifier_option_quantities', 'tenant', null),
    ('branches', 'tenant', null),
    ('cash_transactions', 'tenant', null),
    ('code_sequences', 'tenant', null),
    ('conversations', 'tenant', null),
    ('coupon_usages', 'tenant', null),
    ('delivery_partners', 'tenant', null),
    ('favorites', 'user', null),
    ('inventory_checks', 'tenant', null),
    ('invoices', 'tenant', null),
    ('loyalty_settings', 'tenant', null),
    ('loyalty_transactions', 'tenant', null),
    ('notifications', 'user', null),
    ('profiles', 'self', null),
    ('purchase_orders', 'tenant', null),
    ('sales_channels', 'tenant', null),
    ('sales_returns', 'tenant', null),
    ('shipping_orders', 'tenant', null),
    ('stock_movements', 'tenant_ledger', null),
    ('stock_transfers', 'tenant', null),
    ('tenants', 'tenant_id_is_pk', null),
    ('invoice_items', 'parent', 'invoices'),
    ('purchase_order_items', 'parent', 'purchase_orders'),
    ('return_items', 'parent', 'sales_returns'),
    ('inventory_check_items', 'parent', 'inventory_checks'),
    ('conversation_messages', 'parent', 'conversations'),
    ('stock_transfer_items', 'parent', 'stock_transfers'),
    ('invoice_items_cost_backup_00237', 'blocked_backup', null),
    ('product_lots_backup_00226', 'blocked_backup', null),
    ('product_lots_backup_00231', 'blocked_backup', null)
)
select
  t.table_name,
  t.scope_kind,
  t.parent_table,
  c.oid is not null as table_exists,
  coalesce(c.relrowsecurity, false) as rls_enabled,
  coalesce(c.relforcerowsecurity, false) as rls_forced,
  pg_get_userbyid(c.relowner) as table_owner,
  exists (
    select 1
    from information_schema.columns col
    where col.table_schema = 'public'
      and col.table_name = t.table_name
      and col.column_name = 'tenant_id'
  ) as has_tenant_id,
  count(p.policyname) as policy_count
from targets t
left join pg_class c
  on c.oid = to_regclass(format('public.%I', t.table_name))
left join pg_policies p
  on p.schemaname = 'public'
 and p.tablename = t.table_name
group by
  t.table_name, t.scope_kind, t.parent_table,
  c.oid, c.relrowsecurity, c.relforcerowsecurity, c.relowner
order by t.table_name;

-- 3) Toan bo policy song. Can xem ca permissive/restrictive vi policy
-- permissive cua PostgreSQL duoc gop bang OR.
with targets(table_name) as (
  values
    ('audit_log'), ('bom_modifier_option_quantities'), ('branches'), ('cash_transactions'), ('code_sequences'),
    ('conversations'), ('coupon_usages'), ('delivery_partners'), ('favorites'),
    ('inventory_checks'), ('invoices'), ('loyalty_settings'),
    ('loyalty_transactions'), ('notifications'), ('profiles'),
    ('purchase_orders'), ('sales_channels'), ('sales_returns'),
    ('shipping_orders'), ('stock_movements'), ('stock_transfers'), ('tenants'),
    ('invoice_items'), ('purchase_order_items'), ('return_items'),
    ('inventory_check_items'), ('conversation_messages'),
    ('stock_transfer_items')
)
select
  p.tablename,
  p.policyname,
  p.permissive,
  p.roles,
  p.cmd,
  p.qual,
  p.with_check
from pg_policies p
join targets t on t.table_name = p.tablename
where p.schemaname = 'public'
order by p.tablename, p.cmd, p.policyname;

-- 4) Quyen GRANT song. RLS chi la mot lop; authenticated co ALL thi policy
-- sai se thanh loi mo quyen thuc te.
with targets(table_name) as (
  values
    ('audit_log'), ('bom_modifier_option_quantities'), ('branches'), ('cash_transactions'), ('code_sequences'),
    ('conversations'), ('coupon_usages'), ('delivery_partners'), ('favorites'),
    ('inventory_checks'), ('invoices'), ('loyalty_settings'),
    ('loyalty_transactions'), ('notifications'), ('profiles'),
    ('purchase_orders'), ('sales_channels'), ('sales_returns'),
    ('shipping_orders'), ('stock_movements'), ('stock_transfers'), ('tenants'),
    ('invoice_items'), ('purchase_order_items'), ('return_items'),
    ('inventory_check_items'), ('conversation_messages'),
    ('stock_transfer_items')
)
select
  g.table_name,
  g.grantee,
  string_agg(g.privilege_type, ', ' order by g.privilege_type) as privileges
from information_schema.role_table_grants g
join targets t on t.table_name = g.table_name
where g.table_schema = 'public'
  and g.grantee in ('anon', 'authenticated', 'service_role')
group by g.table_name, g.grantee
order by g.table_name, g.grantee;
