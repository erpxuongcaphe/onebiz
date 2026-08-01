-- Read-only preflight for QC migrations 00242 through 00283.
-- This query does not create, update, or delete business data.

with required(migration, function_name) as (
  values
    ('00242', 'record_invoice_payment'),
    ('00242', 'record_purchase_payment'),
    ('00243', 'create_internal_sale_atomic'),
    ('00244', 'sync_fnb_invoice_item_variants'),
    ('00244', 'create_sales_return_atomic'),
    ('00245', 'receive_purchase_items_atomic'),
    ('00245', 'revert_received_purchase_order_atomic'),
    ('00245', 'update_purchase_order_prices'),
    ('00246', 'apply_manual_stock_movement_atomic'),
    ('00246', 'apply_disposal_export_atomic'),
    ('00246', 'apply_internal_export_atomic'),
    ('00246', 'void_disposal_export_atomic'),
    ('00246', 'void_internal_export_atomic'),
    ('00247', 'create_supplier_return_atomic'),
    ('00248', 'delete_supplier_atomic'),
    ('00248', 'close_purchase_order_short'),
    ('00249', 'apply_inventory_check_atomic'),
    ('00249', 'complete_stock_transfer_atomic'),
    ('00250', 'fnb_complete_payment_atomic'),
    ('00250', 'void_completed_invoice_atomic_v2'),
    ('00251', 'fnb_send_to_kitchen_atomic_v2'),
    ('00251', 'fnb_send_to_kitchen_atomic'),
    ('00252', 'fnb_update_kitchen_item_status_v2'),
    ('00252', 'fnb_update_kitchen_order_status_v2'),
    ('00252', 'fnb_set_delivery_pricing_v2'),
    ('00252', 'assign_delivery_staff_to_order'),
    ('00252', 'complete_delivery_for_order'),
    ('00253', 'recompute_customer_debt'),
    ('00253', 'trg_sync_customer_debt_adjustment'),
    ('00253', 'pos_prepare_retail_checkout'),
    ('00253', 'pos_complete_checkout_atomic_v3'),
    ('00253', 'complete_draft_atomic_v4'),
    ('00253', 'issue_manager_otp'),
    ('00254', 'attach_invoice_shipment_atomic'),
    ('00255', 'fnb_complete_payment_atomic_v2'),
    ('00256', 'create_and_apply_inventory_check_atomic'),
    ('00256', 'create_stock_transfer_atomic'),
    ('00256', 'set_stock_transfer_state_atomic'),
    ('00257', 'get_receivable_aging_report'),
    ('00257', 'get_payable_aging_report'),
    ('00258', 'get_consolidated_profit_and_loss_report'),
    ('00258', 'get_finance_dashboard_report'),
    ('00259', 'get_xnt_report'),
    ('00260', 'get_financial_analysis_details_report'),
    ('00261', 'save_purchase_order_atomic'),
    ('00262', 'set_purchase_order_state_atomic'),
    ('00262', 'close_purchase_order_short'),
    ('00263', 'cancel_inventory_check_atomic'),
    ('00264', 'save_pos_draft_atomic'),
    ('00264', 'adopt_pos_draft_session_atomic'),
    ('00264', 'soft_delete_pos_draft_atomic'),
    ('00265', 'save_sales_order_atomic'),
    ('00266', 'duplicate_invoice_to_order_atomic'),
    ('00267', 'create_manual_cash_transaction_atomic'),
    ('00267', 'cancel_cash_transaction'),
    ('00268', '_create_and_apply_stock_export_00268'),
    ('00268', 'create_internal_export_atomic'),
    ('00268', 'create_disposal_export_atomic'),
    ('00269', '_cancel_stock_export_00269'),
    ('00269', 'cancel_disposal_export_atomic_v2'),
    ('00269', 'cancel_internal_export_atomic_v2'),
    ('00270', 'complete_legacy_sales_order_atomic'),
    ('00270', 'cancel_legacy_sales_order_atomic'),
    ('00271', 'cancel_draft_invoice_atomic'),
    ('00271', 'update_draft_invoice_atomic'),
    ('00272', 'update_received_purchase_order_atomic'),
    ('00273', 'split_kitchen_order_atomic'),
    ('00274', 'fnb_complete_payment_atomic'),
    ('00275', 'mark_fnb_table_available_atomic'),
    ('00276', 'update_shipping_order_status_atomic'),
    ('00277', 'save_branch_atomic'),
    ('00277', 'update_branch_settings_atomic'),
    ('00278', 'patch_tenant_settings_atomic'),
    ('00278', 'set_branch_print_brand_atomic'),
    ('00279', 'update_managed_user_atomic'),
    ('00280', 'initialize_managed_user_atomic'),
    ('00281', 'update_own_profile_atomic'),
    ('00282', 'save_role_atomic'),
    ('00282', 'delete_role_atomic'),
    ('00283', 'create_production_order_atomic'),
    ('00283', 'change_production_status_atomic'),
    ('00283', 'revert_production_materials'),
    ('00283', 'complete_production_atomic')
),
available as (
  select distinct p.proname as function_name
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
),
critical(function_name) as (
  values
    ('record_invoice_payment'), ('record_purchase_payment'),
    ('create_internal_sale_atomic'), ('create_sales_return_atomic'),
    ('create_supplier_return_atomic'), ('create_stock_transfer_atomic'),
    ('save_pos_draft_atomic'), ('save_sales_order_atomic'),
    ('complete_legacy_sales_order_atomic'), ('cancel_legacy_sales_order_atomic'),
    ('split_kitchen_order_atomic'), ('update_shipping_order_status_atomic'),
    ('create_production_order_atomic'), ('change_production_status_atomic'),
    ('revert_production_materials'), ('complete_production_atomic')
)
select
  r.migration,
  r.function_name,
  (a.function_name is not null) as installed,
  (c.function_name is not null) as critical,
  count(*) filter (where a.function_name is null) over () as total_missing,
  count(*) filter (
    where a.function_name is null and c.function_name is not null
  ) over () as critical_missing
from required r
left join available a using (function_name)
left join critical c using (function_name)
order by installed, critical desc, r.migration, r.function_name;
