-- Migration: Inventory Module (Phase 2)
-- Created at: 2025-01-09
-- Description: Creates tables for categories, units, products, branch_products, and inventory_transactions.

-- 1. Units Table (Đơn vị tính)
CREATE TABLE IF NOT EXISTS units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL, -- Ví dụ: Kilogram, Chai, Hộp
    code TEXT NOT NULL, -- Ví dụ: kg, btl, box
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Categories Table (Danh mục sản phẩm)
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    parent_id UUID REFERENCES categories(id) ON DELETE SET NULL, -- Hỗ trợ danh mục đa cấp
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Products Table (Sản phẩm & Nguyên vật liệu)
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL, -- SKU / Mã sản phẩm
    name TEXT NOT NULL,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
    
    type TEXT CHECK (type IN ('raw_material', 'finished_product', 'service')) DEFAULT 'finished_product',
    -- raw_material: Nguyên liệu (Đường, Sữa...)
    -- finished_product: Thành phẩm bán (Cà phê sữa, Bánh...)
    -- service: Dịch vụ (Phí phục vụ...)

    cost_price NUMERIC(15, 2) DEFAULT 0, -- Giá vốn tham khảo
    selling_price NUMERIC(15, 2) DEFAULT 0, -- Giá bán niêm yết

    min_stock_level NUMERIC(15, 2) DEFAULT 0, -- Định mức tồn tối thiểu chung
    max_stock_level NUMERIC(15, 2), -- Định mức tồn tối đa chung

    image_url TEXT,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Branch Products (Tồn kho theo chi nhánh)
CREATE TABLE IF NOT EXISTS branch_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- Surrogate key for easier referencing if needed
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    
    stock_quantity NUMERIC(15, 4) DEFAULT 0, -- Số lượng tồn (cho phép số lẻ với nguyên liệu kg/l)
    average_cost NUMERIC(15, 2) DEFAULT 0, -- Giá vốn bình quân tại chi nhánh này
    
    location TEXT, -- Vị trí trong kho (Kệ A, Tủ đông...)
    min_stock_level NUMERIC(15, 2), -- Định mức tồn tối thiểu riêng cho chi nhánh (override global)
    max_stock_level NUMERIC(15, 2), -- Định mức tồn tối đa riêng cho chi nhánh
    
    last_checked_at TIMESTAMPTZ, -- Lần kiểm kho gần nhất
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(branch_id, product_id)
);

-- 5. Inventory Transactions (Lịch sử biến động kho)
CREATE TABLE IF NOT EXISTS inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    
    type TEXT NOT NULL CHECK (type IN ('import', 'export', 'adjustment', 'transfer_in', 'transfer_out', 'sale', 'return')),
    -- import: Nhập hàng NCC
    -- export: Xuất hủy/hư hỏng
    -- adjustment: Kiểm kho điều chỉnh
    -- transfer_in/out: Chuyển kho giữa các chi nhánh
    -- sale: Bán hàng (trừ kho)
    -- return: Khách trả hàng (cộng kho)

    quantity NUMERIC(15, 4) NOT NULL, -- Số lượng thay đổi (+ hoặc -)
    quantity_before NUMERIC(15, 4), -- Tồn trước khi giao dịch
    quantity_after NUMERIC(15, 4), -- Tồn sau khi giao dịch
    
    unit_price NUMERIC(15, 2), -- Giá đơn vị tại thời điểm giao dịch
    total_amount NUMERIC(15, 2), -- Tổng giá trị
    
    reference_id TEXT, -- Mã phiếu / Mã đơn hàng liên quan
    note TEXT,
    
    created_by UUID, -- Link to auth.users theoretically, but keeping as UUID for flexibility
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_code ON products(code);
CREATE INDEX IF NOT EXISTS idx_branch_products_branch ON branch_products(branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_branch_date ON inventory_transactions(branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_product ON inventory_transactions(product_id);

-- Add default units if not exist
INSERT INTO units (name, code) VALUES 
('Cái', 'pcs'),
('Kilogram', 'kg'),
('Gram', 'g'),
('Lít', 'l'),
('Mililit', 'ml'),
('Hộp', 'box'),
('Chai', 'btl'),
('Lon', 'can')
ON CONFLICT DO NOTHING;

-- Add default categories if not exist
INSERT INTO categories (name, description) VALUES 
('Nguyên vật liệu', 'Đường, Sữa, Cà phê hạt...'),
('Đồ uống', 'Cà phê, Trà, Nước ngọt...'),
('Thức ăn', 'Bánh ngọt, Snack...'),
('Bao bì', 'Ly, Ống hút, Túi...')
ON CONFLICT DO NOTHING;
