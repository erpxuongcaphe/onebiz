-- Sales Orders Migration
-- Quản lý đơn bán hàng với workflow và stock reservation

-- =====================================================
-- 1. SALES ORDERS TABLE (Header)
-- =====================================================
CREATE TABLE IF NOT EXISTS sales_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Số đơn hàng (tự động)
    order_number VARCHAR(50) NOT NULL,
    
    -- Khách hàng
    customer_id UUID NOT NULL REFERENCES sales_customers(id),
    
    -- Kho xuất và chi nhánh
    warehouse_id UUID REFERENCES inventory_warehouses(id),
    branch_id UUID REFERENCES branches(id),
    
    -- Ngày tháng
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_delivery_date DATE,
    
    -- Tổng tiền
    subtotal DECIMAL(15, 2) NOT NULL DEFAULT 0,
    discount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    tax DECIMAL(15, 2) NOT NULL DEFAULT 0,
    total DECIMAL(15, 2) NOT NULL DEFAULT 0,
    
    -- Trạng thái đơn hàng
    -- draft: Nháp
    -- confirmed: Đã xác nhận (stock reserved)
    -- picking: Đang lấy hàng
    -- delivering: Đang giao hàng
    -- delivered: Đã giao hàng
    -- completed: Hoàn thành
    -- cancelled: Đã hủy
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'confirmed', 'picking', 'delivering', 'delivered', 'completed', 'cancelled')),
    
    -- Ghi chú
    notes TEXT,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    
    -- Unique constraint
    UNIQUE(tenant_id, order_number)
);

-- Indexes
CREATE INDEX idx_sales_orders_tenant ON sales_orders(tenant_id);
CREATE INDEX idx_sales_orders_customer ON sales_orders(customer_id);
CREATE INDEX idx_sales_orders_status ON sales_orders(status);
CREATE INDEX idx_sales_orders_date ON sales_orders(order_date);
CREATE INDEX idx_sales_orders_number ON sales_orders(order_number);

-- Updated timestamp trigger
CREATE TRIGGER update_sales_orders_updated_at
    BEFORE UPDATE ON sales_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 2. SALES ORDER ITEMS TABLE (Line Items)
-- =====================================================
CREATE TABLE IF NOT EXISTS sales_order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Link đến đơn hàng
    order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    
    -- Sản phẩm
    product_id UUID NOT NULL REFERENCES inventory_products(id),
    
    -- Số lượng
    quantity DECIMAL(10, 3) NOT NULL CHECK (quantity > 0),
    
    -- Số lượng đã giao
    delivered_quantity DECIMAL(10, 3) NOT NULL DEFAULT 0 CHECK (delivered_quantity >= 0),
    
    -- Giá và chiết khấu
    unit_price DECIMAL(15, 2) NOT NULL CHECK (unit_price >= 0),
    discount_percent DECIMAL(5, 2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
    tax_percent DECIMAL(5, 2) NOT NULL DEFAULT 10 CHECK (tax_percent >= 0 AND tax_percent <= 100),
    
    -- Ghi chú
    notes TEXT,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_sales_order_items_order ON sales_order_items(order_id);
CREATE INDEX idx_sales_order_items_product ON sales_order_items(product_id);

-- =====================================================
-- 3. AUTO-NUMBER GENERATION FUNCTION
-- =====================================================
CREATE OR REPLACE FUNCTION generate_sales_order_number(p_tenant_id UUID)
RETURNS VARCHAR(50)
LANGUAGE plpgsql
AS $$
DECLARE
    v_count INTEGER;
    v_number VARCHAR(50);
    v_year VARCHAR(4);
    v_month VARCHAR(2);
BEGIN
    -- Lấy năm và tháng hiện tại
    v_year := TO_CHAR(CURRENT_DATE, 'YY');
    v_month := TO_CHAR(CURRENT_DATE, 'MM');
    
    -- Đếm số đơn hàng trong tháng
    SELECT COUNT(*) INTO v_count
    FROM sales_orders
    WHERE tenant_id = p_tenant_id
      AND order_number LIKE 'SO' || v_year || v_month || '%';
    
    -- Tạo số đơn hàng: SO + YY + MM + 0001
    v_number := 'SO' || v_year || v_month || LPAD((v_count + 1)::TEXT, 4, '0');
    
    RETURN v_number;
END;
$$;

-- =====================================================
-- 4. STOCK RESERVATION FUNCTION
-- =====================================================
-- Reserve stock khi confirm sales order
CREATE OR REPLACE FUNCTION reserve_stock_for_sales_order(p_order_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_warehouse_id UUID;
    v_tenant_id UUID;
    v_item RECORD;
    v_available_stock DECIMAL(10, 3);
BEGIN
    -- Lấy thông tin đơn hàng
    SELECT warehouse_id, tenant_id INTO v_warehouse_id, v_tenant_id
    FROM sales_orders
    WHERE id = p_order_id;
    
    IF v_warehouse_id IS NULL THEN
        RAISE EXCEPTION 'Warehouse not specified for sales order';
    END IF;
    
    -- Kiểm tra và reserve stock cho từng item
    FOR v_item IN 
        SELECT product_id, quantity
        FROM sales_order_items
        WHERE order_id = p_order_id
    LOOP
        -- Kiểm tra tồn kho available
        SELECT COALESCE(quantity, 0) INTO v_available_stock
        FROM inventory_stock
        WHERE product_id = v_item.product_id
          AND warehouse_id = v_warehouse_id
          AND tenant_id = v_tenant_id;
        
        IF v_available_stock < v_item.quantity THEN
            RAISE EXCEPTION 'Insufficient stock for product %', v_item.product_id;
        END IF;
        
        -- Không cần update stock ở đây, chỉ kiểm tra
        -- Stock sẽ giảm khi delivery order completed
    END LOOP;
    
    RETURN TRUE;
END;
$$;

-- =====================================================
-- 5. ROW LEVEL SECURITY (RLS)
-- =====================================================
ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_items ENABLE ROW LEVEL SECURITY;

-- Policy cho sales_orders
CREATE POLICY sales_orders_tenant_isolation ON sales_orders
    FOR ALL
    USING (
        tenant_id IN (
            SELECT tenant_id FROM profiles WHERE id = auth.uid()
        )
    );

-- Policy cho sales_order_items
CREATE POLICY sales_order_items_tenant_isolation ON sales_order_items
    FOR ALL
    USING (
        order_id IN (
            SELECT id FROM sales_orders
            WHERE tenant_id IN (
                SELECT tenant_id FROM profiles WHERE id = auth.uid()
            )
        )
    );

-- =====================================================
-- 6. COMMENTS
-- =====================================================
COMMENT ON TABLE sales_orders IS 'Đơn bán hàng cho khách hàng';
COMMENT ON COLUMN sales_orders.order_number IS 'Số đơn hàng tự động (ví dụ: SO260101-0001)';
COMMENT ON COLUMN sales_orders.customer_id IS 'Khách hàng đặt hàng';
COMMENT ON COLUMN sales_orders.warehouse_id IS 'Kho xuất hàng';
COMMENT ON COLUMN sales_orders.status IS 'Trạng thái: draft, confirmed, picking, delivering, delivered, completed, cancelled';
COMMENT ON COLUMN sales_orders.subtotal IS 'Tổng tiền trước chiết khấu và thuế';
COMMENT ON COLUMN sales_orders.discount IS 'Tổng chiết khấu';
COMMENT ON COLUMN sales_orders.tax IS 'Tổng thuế VAT';
COMMENT ON COLUMN sales_orders.total IS 'Tổng tiền cuối cùng';

COMMENT ON TABLE sales_order_items IS 'Chi tiết sản phẩm trong đơn bán hàng';
COMMENT ON COLUMN sales_order_items.quantity IS 'Số lượng đặt';
COMMENT ON COLUMN sales_order_items.delivered_quantity IS 'Số lượng đã giao';
COMMENT ON COLUMN sales_order_items.unit_price IS 'Đơn giá bán';
COMMENT ON COLUMN sales_order_items.discount_percent IS 'Phần trăm chiết khấu (0-100)';
COMMENT ON COLUMN sales_order_items.tax_percent IS 'Phần trăm thuế VAT (0-100)';
