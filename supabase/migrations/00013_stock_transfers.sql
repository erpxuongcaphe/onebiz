-- ============================================================
-- Migration 00013: Stock Transfers (Chuyển kho giữa chi nhánh)
-- Sprint 7 "Toàn Cảnh"
-- ============================================================

-- stock_transfers: Header phiếu chuyển kho
CREATE TABLE IF NOT EXISTS stock_transfers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  code          text NOT NULL,
  from_branch_id uuid NOT NULL REFERENCES branches(id),
  to_branch_id   uuid NOT NULL REFERENCES branches(id),
  status        text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'in_transit', 'completed', 'cancelled')),
  total_items   int NOT NULL DEFAULT 0,
  note          text,
  created_by    uuid REFERENCES profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,

  CONSTRAINT different_branches CHECK (from_branch_id <> to_branch_id)
);

-- stock_transfer_items: Chi tiết từng sản phẩm chuyển
CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id     uuid NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id      uuid NOT NULL REFERENCES products(id),
  product_name    text NOT NULL DEFAULT '',
  product_code    text NOT NULL DEFAULT '',
  unit            text,
  quantity        numeric NOT NULL DEFAULT 0 CHECK (quantity > 0),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_stock_transfers_tenant ON stock_transfers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_status ON stock_transfers(status);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_from   ON stock_transfers(from_branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to     ON stock_transfers(to_branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer ON stock_transfer_items(transfer_id);

-- RLS policies
ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stock_transfers_tenant_isolation" ON stock_transfers
  FOR ALL USING (tenant_id = auth.uid()::uuid OR true);

CREATE POLICY "stock_transfer_items_via_transfer" ON stock_transfer_items
  FOR ALL USING (true);

-- Triggers: updated_at
CREATE TRIGGER handle_updated_at_stock_transfers
  BEFORE UPDATE ON stock_transfers
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Dev mode: disable RLS (consistent with 00010)
ALTER TABLE stock_transfers DISABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_items DISABLE ROW LEVEL SECURITY;
