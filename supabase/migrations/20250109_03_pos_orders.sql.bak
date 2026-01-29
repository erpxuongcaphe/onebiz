-- =============================================
-- Migration: POS Orders Module
-- Date: 2025-01-09
-- Description: Creates tables for POS orders and order items
-- =============================================

-- 1. ORDERS TABLE (Đơn hàng)
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    table_id UUID REFERENCES pos_tables(id) ON DELETE SET NULL,
    
    -- Order Info
    order_number TEXT UNIQUE NOT NULL,  -- ORD-YYYYMMDD-0001
    order_type TEXT CHECK (order_type IN ('dine_in', 'takeaway', 'delivery')) DEFAULT 'dine_in',
    status TEXT CHECK (status IN ('draft', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled')) DEFAULT 'draft',
    
    -- Customer (optional)
    customer_name TEXT,
    customer_phone TEXT,
    
    -- Pricing
    subtotal NUMERIC(15, 2) DEFAULT 0,
    discount_type TEXT CHECK (discount_type IN ('percent', 'fixed')) DEFAULT 'fixed',
    discount_value NUMERIC(15, 2) DEFAULT 0,
    discount_amount NUMERIC(15, 2) DEFAULT 0,  -- Calculated discount
    tax_rate NUMERIC(5, 2) DEFAULT 0,  -- VAT %
    tax_amount NUMERIC(15, 2) DEFAULT 0,
    total NUMERIC(15, 2) DEFAULT 0,
    
    -- Payment
    payment_status TEXT CHECK (payment_status IN ('unpaid', 'partial', 'paid')) DEFAULT 'unpaid',
    payment_method TEXT CHECK (payment_method IN ('cash', 'card', 'transfer', 'momo', 'zalopay', 'mixed')),
    amount_paid NUMERIC(15, 2) DEFAULT 0,
    change_amount NUMERIC(15, 2) DEFAULT 0,
    
    -- Notes
    notes TEXT,
    kitchen_notes TEXT,
    
    -- Timestamps
    created_by UUID,
    served_by UUID,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. ORDER ITEMS TABLE (Chi tiết đơn hàng)
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    
    -- Item Details
    product_name TEXT NOT NULL,   -- Snapshot at order time
    quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
    unit_price NUMERIC(15, 2) NOT NULL,
    
    -- Discount per item
    discount_type TEXT CHECK (discount_type IN ('percent', 'fixed')) DEFAULT 'fixed',
    discount_value NUMERIC(15, 2) DEFAULT 0,
    discount_amount NUMERIC(15, 2) DEFAULT 0,
    
    -- Total
    line_total NUMERIC(15, 2) NOT NULL,  -- (quantity * unit_price) - discount
    
    -- Notes (ít đường, thêm đá, etc.)
    notes TEXT,
    
    -- Status
    status TEXT CHECK (status IN ('pending', 'preparing', 'ready', 'served', 'cancelled')) DEFAULT 'pending',
    
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. TABLE STATUS ENUM (Trạng thái bàn)
-- We'll track via orders, but add a current_order_id for quick lookup
ALTER TABLE pos_tables 
ADD COLUMN IF NOT EXISTS current_order_id UUID REFERENCES orders(id) ON DELETE SET NULL;

-- 4. INDEXES
CREATE INDEX IF NOT EXISTS idx_orders_branch ON orders(branch_id);
CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(table_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);

-- 5. FUNCTION: Generate Order Number
CREATE OR REPLACE FUNCTION generate_order_number(p_branch_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_date TEXT;
    v_count INT;
    v_branch_code TEXT;
BEGIN
    v_date := TO_CHAR(NOW(), 'YYYYMMDD');
    
    -- Get branch code (first 2 chars)
    SELECT COALESCE(SUBSTRING(code, 1, 2), 'XX') INTO v_branch_code
    FROM branches WHERE id = p_branch_id;
    
    -- Count today's orders for this branch
    SELECT COUNT(*) + 1 INTO v_count
    FROM orders
    WHERE branch_id = p_branch_id
    AND DATE(created_at) = CURRENT_DATE;
    
    RETURN v_branch_code || '-' || v_date || '-' || LPAD(v_count::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- 6. TRIGGER: Auto-generate order number
CREATE OR REPLACE FUNCTION trigger_set_order_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
        NEW.order_number := generate_order_number(NEW.branch_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_order_number ON orders;
CREATE TRIGGER set_order_number
    BEFORE INSERT ON orders
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_order_number();

-- 7. TRIGGER: Update order totals
CREATE OR REPLACE FUNCTION update_order_totals()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE orders
    SET 
        subtotal = (SELECT COALESCE(SUM(line_total), 0) FROM order_items WHERE order_id = COALESCE(NEW.order_id, OLD.order_id)),
        updated_at = NOW()
    WHERE id = COALESCE(NEW.order_id, OLD.order_id);
    
    -- Recalculate total with discount and tax
    UPDATE orders
    SET 
        discount_amount = CASE 
            WHEN discount_type = 'percent' THEN subtotal * (discount_value / 100)
            ELSE discount_value
        END,
        tax_amount = (subtotal - CASE 
            WHEN discount_type = 'percent' THEN subtotal * (discount_value / 100)
            ELSE discount_value
        END) * (tax_rate / 100),
        total = subtotal - CASE 
            WHEN discount_type = 'percent' THEN subtotal * (discount_value / 100)
            ELSE discount_value
        END + (subtotal - CASE 
            WHEN discount_type = 'percent' THEN subtotal * (discount_value / 100)
            ELSE discount_value
        END) * (tax_rate / 100)
    WHERE id = COALESCE(NEW.order_id, OLD.order_id);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_order_totals_trigger ON order_items;
CREATE TRIGGER update_order_totals_trigger
    AFTER INSERT OR UPDATE OR DELETE ON order_items
    FOR EACH ROW
    EXECUTE FUNCTION update_order_totals();

-- 8. TRIGGER: Update table status when order changes
CREATE OR REPLACE FUNCTION update_table_order_status()
RETURNS TRIGGER AS $$
BEGIN
    -- When order is created or updated
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        IF NEW.table_id IS NOT NULL AND NEW.status NOT IN ('completed', 'cancelled') THEN
            UPDATE pos_tables SET current_order_id = NEW.id WHERE id = NEW.table_id;
        ELSIF NEW.table_id IS NOT NULL AND NEW.status IN ('completed', 'cancelled') THEN
            UPDATE pos_tables SET current_order_id = NULL WHERE id = NEW.table_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_table_order_status_trigger ON orders;
CREATE TRIGGER update_table_order_status_trigger
    AFTER INSERT OR UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_table_order_status();

-- 9. ROW LEVEL SECURITY
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for orders" ON orders;
DROP POLICY IF EXISTS "Allow all for order_items" ON order_items;

CREATE POLICY "Allow all for orders" ON orders FOR ALL USING (true);
CREATE POLICY "Allow all for order_items" ON order_items FOR ALL USING (true);

-- 10. COMMENTS
COMMENT ON TABLE orders IS 'Đơn hàng POS';
COMMENT ON TABLE order_items IS 'Chi tiết đơn hàng';
COMMENT ON COLUMN orders.order_type IS 'dine_in=Tại chỗ, takeaway=Mang đi, delivery=Giao hàng';
COMMENT ON COLUMN orders.status IS 'Trạng thái đơn: draft->confirmed->preparing->ready->completed';
