-- Delivery Orders Migration
-- Quản lý phiếu xuất kho và giao hàng

-- =====================================================
-- 1. DELIVERY ORDERS TABLE (Header)
-- =====================================================
CREATE TABLE IF NOT EXISTS delivery_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Số phiếu xuất (tự động)
    delivery_number VARCHAR(50) NOT NULL,
    
    -- Link đến đơn bán hàng (optional)
    sales_order_id UUID REFERENCES sales_orders(id),
    
    -- Khách hàng và kho
    customer_id UUID NOT NULL REFERENCES sales_customers(id),
    warehouse_id UUID NOT NULL REFERENCES inventory_warehouses(id),
    branch_id UUID REFERENCES branches(id),
    
    -- Ngày tháng
    delivery_date DATE NOT NULL DEFAULT CURRENT_DATE,
    actual_delivery_date DATE,
    
    -- Trạng thái
    -- draft: Nháp
    -- in_transit: Đang vận chuyển
    -- delivered: Đã giao hàng
    -- returned: Đã trả lại
    -- cancelled: Đã hủy
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'in_transit', 'delivered', 'returned', 'cancelled')),
    
    -- Thông tin giao hàng
    shipping_address TEXT,
    receiver_name VARCHAR(255),
    receiver_phone VARCHAR(20),
    
    -- Proof of delivery
    pod_image_url TEXT,
    delivery_notes TEXT,
    
    -- Ghi chú
    notes TEXT,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    completed_at TIMESTAMPTZ,
    completed_by UUID REFERENCES auth.users(id),
    
    -- Unique constraint
    UNIQUE(tenant_id, delivery_number)
);

-- Indexes
CREATE INDEX idx_delivery_orders_tenant ON delivery_orders(tenant_id);
CREATE INDEX idx_delivery_orders_sales_order ON delivery_orders(sales_order_id);
CREATE INDEX idx_delivery_orders_customer ON delivery_orders(customer_id);
CREATE INDEX idx_delivery_orders_warehouse ON delivery_orders(warehouse_id);
CREATE INDEX idx_delivery_orders_status ON delivery_orders(status);
CREATE INDEX idx_delivery_orders_date ON delivery_orders(delivery_date);
CREATE INDEX idx_delivery_orders_number ON delivery_orders(delivery_number);

-- Updated timestamp trigger
CREATE TRIGGER update_delivery_orders_updated_at
    BEFORE UPDATE ON delivery_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 2. DELIVERY ORDER ITEMS TABLE (Line Items)
-- =====================================================
CREATE TABLE IF NOT EXISTS delivery_order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Link đến phiếu xuất
    delivery_id UUID NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
    
    -- Sản phẩm
    product_id UUID NOT NULL REFERENCES inventory_products(id),
    
    -- Số lượng xuất
    quantity DECIMAL(10, 3) NOT NULL CHECK (quantity > 0),
    
    -- Link đến sales order item (nếu có)
    sales_order_item_id UUID REFERENCES sales_order_items(id),
    
    -- Ghi chú
    notes TEXT,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_delivery_order_items_delivery ON delivery_order_items(delivery_id);
CREATE INDEX idx_delivery_order_items_product ON delivery_order_items(product_id);
CREATE INDEX idx_delivery_order_items_so_item ON delivery_order_items(sales_order_item_id);

-- =====================================================
-- 3. AUTO-NUMBER GENERATION FUNCTION
-- =====================================================
CREATE OR REPLACE FUNCTION generate_delivery_number(p_tenant_id UUID)
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
    
    -- Đếm số phiếu xuất trong tháng
    SELECT COUNT(*) INTO v_count
    FROM delivery_orders
    WHERE tenant_id = p_tenant_id
      AND delivery_number LIKE 'DO' || v_year || v_month || '%';
    
    -- Tạo số phiếu xuất: DO + YY + MM + 0001
    v_number := 'DO' || v_year || v_month || LPAD((v_count + 1)::TEXT, 4, '0');
    
    RETURN v_number;
END;
$$;

-- =====================================================
-- 4. COMPLETE DELIVERY ORDER FUNCTION
-- =====================================================
-- Complete delivery and update stock OUT
CREATE OR REPLACE FUNCTION complete_delivery_order(p_delivery_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_warehouse_id UUID;
    v_tenant_id UUID;
    v_sales_order_id UUID;
    v_status VARCHAR(20);
    v_item RECORD;
BEGIN
    -- Lấy thông tin delivery order
    SELECT warehouse_id, tenant_id, sales_order_id, status
    INTO v_warehouse_id, v_tenant_id, v_sales_order_id, v_status
    FROM delivery_orders
    WHERE id = p_delivery_id;
    
    -- Kiểm tra status
    IF v_status != 'draft' THEN
        RAISE EXCEPTION 'Only draft delivery orders can be completed';
    END IF;
    
    -- Update stock OUT cho từng item
    FOR v_item IN 
        SELECT doi.product_id, doi.quantity, doi.sales_order_item_id
        FROM delivery_order_items doi
        WHERE doi.delivery_id = p_delivery_id
    LOOP
        -- Giảm tồn kho
        UPDATE inventory_stock
        SET quantity = quantity - v_item.quantity,
            updated_at = NOW()
        WHERE product_id = v_item.product_id
          AND warehouse_id = v_warehouse_id
          AND tenant_id = v_tenant_id;
        
        -- Nếu không có record, tạo mới với số âm (cho phép overselling)
        IF NOT FOUND THEN
            INSERT INTO inventory_stock (
                tenant_id, product_id, warehouse_id, quantity
            ) VALUES (
                v_tenant_id, v_item.product_id, v_warehouse_id, -v_item.quantity
            );
        END IF;
        
        -- Cập nhật delivered_quantity trên sales order item
        IF v_item.sales_order_item_id IS NOT NULL THEN
            UPDATE sales_order_items
            SET delivered_quantity = delivered_quantity + v_item.quantity
            WHERE id = v_item.sales_order_item_id;
        END IF;
    END LOOP;
    
    -- Update delivery order status
    UPDATE delivery_orders
    SET status = 'delivered',
        completed_at = NOW(),
        completed_by = p_user_id,
        actual_delivery_date = CURRENT_DATE
    WHERE id = p_delivery_id;
    
    -- Update sales order status nếu đã giao đủ
    IF v_sales_order_id IS NOT NULL THEN
        -- Kiểm tra xem đã giao đủ chưa
        DECLARE
            v_all_delivered BOOLEAN;
        BEGIN
            SELECT BOOL_AND(delivered_quantity >= quantity) INTO v_all_delivered
            FROM sales_order_items
            WHERE order_id = v_sales_order_id;
            
            IF v_all_delivered THEN
                UPDATE sales_orders
                SET status = 'delivered'
                WHERE id = v_sales_order_id
                  AND status = 'delivering';
            ELSE
                -- Partial delivery
                UPDATE sales_orders
                SET status = 'delivering'
                WHERE id = v_sales_order_id
                  AND status IN ('confirmed', 'picking');
            END IF;
        END;
    END IF;
    
    RETURN TRUE;
END;
$$;

-- =====================================================
-- 5. VOID DELIVERY ORDER FUNCTION
-- =====================================================
CREATE OR REPLACE FUNCTION void_delivery_order(p_delivery_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_status VARCHAR(20);
BEGIN
    -- Lấy status
    SELECT status INTO v_status
    FROM delivery_orders
    WHERE id = p_delivery_id;
    
    -- Chỉ cho phép void draft delivery
    IF v_status != 'draft' THEN
        RAISE EXCEPTION 'Only draft delivery orders can be voided';
    END IF;
    
    -- Update status
    UPDATE delivery_orders
    SET status = 'cancelled'
    WHERE id = p_delivery_id;
    
    RETURN TRUE;
END;
$$;

-- =====================================================
-- 6. ROW LEVEL SECURITY (RLS)
-- =====================================================
ALTER TABLE delivery_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_order_items ENABLE ROW LEVEL SECURITY;

-- Policy cho delivery_orders
CREATE POLICY delivery_orders_tenant_isolation ON delivery_orders
    FOR ALL
    USING (
        tenant_id IN (
            SELECT tenant_id FROM profiles WHERE id = auth.uid()
        )
    );

-- Policy cho delivery_order_items
CREATE POLICY delivery_order_items_tenant_isolation ON delivery_order_items
    FOR ALL
    USING (
        delivery_id IN (
            SELECT id FROM delivery_orders
            WHERE tenant_id IN (
                SELECT tenant_id FROM profiles WHERE id = auth.uid()
            )
        )
    );

-- =====================================================
-- 7. COMMENTS
-- =====================================================
COMMENT ON TABLE delivery_orders IS 'Phiếu xuất kho và giao hàng';
COMMENT ON COLUMN delivery_orders.delivery_number IS 'Số phiếu xuất tự động (ví dụ: DO260101-0001)';
COMMENT ON COLUMN delivery_orders.sales_order_id IS 'Đơn bán hàng liên quan (nếu có)';
COMMENT ON COLUMN delivery_orders.customer_id IS 'Khách hàng nhận hàng';
COMMENT ON COLUMN delivery_orders.warehouse_id IS 'Kho xuất hàng';
COMMENT ON COLUMN delivery_orders.status IS 'Trạng thái: draft, in_transit, delivered, returned, cancelled';
COMMENT ON COLUMN delivery_orders.pod_image_url IS 'Ảnh chứng từ giao hàng (Proof of Delivery)';

COMMENT ON TABLE delivery_order_items IS 'Chi tiết sản phẩm trong phiếu xuất kho';
COMMENT ON COLUMN delivery_order_items.quantity IS 'Số lượng xuất kho';
COMMENT ON COLUMN delivery_order_items.sales_order_item_id IS 'Link đến item trong đơn bán hàng';
