-- Installed view projection before the request-context performance migration.
CREATE VIEW public.invoice_items_scoped WITH (security_barrier=true) AS  SELECT id,
    invoice_id,
    product_id,
    product_name,
    unit,
    quantity,
    unit_price,
    discount,
    total,
    vat_rate,
    vat_amount,
    returned_qty,
        CASE
            WHEN user_has_permission(auth.uid(), 'products.view_cost'::text) THEN unit_cost
            ELSE 0::numeric
        END AS unit_cost,
    note,
    variant_id,
    fnb_gross_amount,
    transaction_quantity,
    transaction_unit,
    transaction_unit_price,
    conversion_factor
   FROM invoice_items t
  WHERE (EXISTS ( SELECT 1
           FROM invoices o
          WHERE o.id = t.invoice_id AND _can_read_branch_inventory_00476(auth.uid(), o.tenant_id, o.branch_id))) AND (EXISTS ( SELECT 1
           FROM profiles p
          WHERE p.id = auth.uid() AND COALESCE(p.is_active, true)));
CREATE VIEW public.stock_movements_scoped WITH (security_barrier=true) AS  SELECT id,
    tenant_id,
    branch_id,
    product_id,
    type,
    quantity,
    reference_type,
    reference_id,
    note,
    created_by,
    created_at,
        CASE
            WHEN user_has_permission(auth.uid(), 'products.view_cost'::text) THEN unit_cost
            ELSE 0::numeric
        END AS unit_cost,
        CASE
            WHEN user_has_permission(auth.uid(), 'products.view_cost'::text) THEN unit_price
            ELSE 0::numeric
        END AS unit_price
   FROM stock_movements t
  WHERE _can_read_branch_inventory_00476(auth.uid(), tenant_id, branch_id) AND (EXISTS ( SELECT 1
           FROM profiles p
          WHERE p.id = auth.uid() AND COALESCE(p.is_active, true)));
