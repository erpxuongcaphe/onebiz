-- ============================================================
-- Sprint A: F&B Seed — Restaurant tables + kitchen_order entity for next_code
-- ============================================================

-- Register 'kitchen_order' entity for code generation (KB prefix)
-- The code_sequences table stores next sequence per tenant+entity
-- next_code() RPC will auto-create the row on first call, so we just
-- need to make sure the prefix mapping exists.

-- Insert default tables for the first branch (if any)
-- This will be done via the app UI in production.
-- For dev/demo, we insert sample tables:

DO $$
DECLARE
  v_tenant_id uuid;
  v_branch_id uuid;
BEGIN
  -- Get first tenant + first branch
  SELECT id INTO v_tenant_id FROM public.tenants LIMIT 1;
  IF v_tenant_id IS NULL THEN RETURN; END IF;

  SELECT id INTO v_branch_id FROM public.branches
    WHERE tenant_id = v_tenant_id AND is_active = true
    ORDER BY is_default DESC LIMIT 1;
  IF v_branch_id IS NULL THEN RETURN; END IF;

  -- Tầng 1: Bàn 1-8
  INSERT INTO public.restaurant_tables (tenant_id, branch_id, table_number, name, zone, capacity, sort_order)
  VALUES
    (v_tenant_id, v_branch_id, 1, 'Bàn 1', 'Tầng 1', 4, 1),
    (v_tenant_id, v_branch_id, 2, 'Bàn 2', 'Tầng 1', 4, 2),
    (v_tenant_id, v_branch_id, 3, 'Bàn 3', 'Tầng 1', 2, 3),
    (v_tenant_id, v_branch_id, 4, 'Bàn 4', 'Tầng 1', 2, 4),
    (v_tenant_id, v_branch_id, 5, 'Bàn 5', 'Tầng 1', 6, 5),
    (v_tenant_id, v_branch_id, 6, 'Bàn 6', 'Tầng 1', 4, 6),
    (v_tenant_id, v_branch_id, 7, 'Bàn 7', 'Tầng 1', 4, 7),
    (v_tenant_id, v_branch_id, 8, 'Bàn 8', 'Tầng 1', 8, 8)
  ON CONFLICT DO NOTHING;

  -- Tầng 2: Bàn 11-18
  INSERT INTO public.restaurant_tables (tenant_id, branch_id, table_number, name, zone, capacity, sort_order)
  VALUES
    (v_tenant_id, v_branch_id, 11, 'Bàn 11', 'Tầng 2', 4, 11),
    (v_tenant_id, v_branch_id, 12, 'Bàn 12', 'Tầng 2', 4, 12),
    (v_tenant_id, v_branch_id, 13, 'Bàn 13', 'Tầng 2', 2, 13),
    (v_tenant_id, v_branch_id, 14, 'Bàn 14', 'Tầng 2', 2, 14),
    (v_tenant_id, v_branch_id, 15, 'Bàn 15', 'Tầng 2', 6, 15),
    (v_tenant_id, v_branch_id, 16, 'Bàn 16', 'Tầng 2', 4, 16),
    (v_tenant_id, v_branch_id, 17, 'Bàn 17', 'Tầng 2', 4, 17),
    (v_tenant_id, v_branch_id, 18, 'Bàn 18', 'Tầng 2', 8, 18)
  ON CONFLICT DO NOTHING;

  -- Ngoài trời: Bàn 19-22
  INSERT INTO public.restaurant_tables (tenant_id, branch_id, table_number, name, zone, capacity, sort_order)
  VALUES
    (v_tenant_id, v_branch_id, 19, 'Bàn 19', 'Ngoài trời', 4, 19),
    (v_tenant_id, v_branch_id, 20, 'Bàn 20', 'Ngoài trời', 4, 20),
    (v_tenant_id, v_branch_id, 21, 'Bàn 21', 'Ngoài trời', 2, 21),
    (v_tenant_id, v_branch_id, 22, 'Bàn 22', 'Ngoài trời', 6, 22)
  ON CONFLICT DO NOTHING;

END $$;
