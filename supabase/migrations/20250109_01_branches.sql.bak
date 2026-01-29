-- =============================================
-- Migration: Multi-Branch Support for ERP
-- Date: 2025-01-09
-- Description: Add new columns to branches and create new tables for floor plan
-- =============================================

-- NOTE: branches table already exists with basic columns
-- We'll ADD new columns instead of creating table

-- 1. ADD NEW COLUMNS TO BRANCHES TABLE (if they don't exist)
DO $$
BEGIN
    -- Add code column (unique code for branch)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'branches' AND column_name = 'code') THEN
        ALTER TABLE branches ADD COLUMN code TEXT UNIQUE;
    END IF;
    
    -- Add phone column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'branches' AND column_name = 'phone') THEN
        ALTER TABLE branches ADD COLUMN phone TEXT;
    END IF;
    
    -- Add email column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'branches' AND column_name = 'email') THEN
        ALTER TABLE branches ADD COLUMN email TEXT;
    END IF;
    
    -- Add is_headquarters column (alias for is_office)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'branches' AND column_name = 'is_headquarters') THEN
        ALTER TABLE branches ADD COLUMN is_headquarters BOOLEAN DEFAULT false;
    END IF;
    
    -- Add is_warehouse column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'branches' AND column_name = 'is_warehouse') THEN
        ALTER TABLE branches ADD COLUMN is_warehouse BOOLEAN DEFAULT false;
    END IF;
    
    -- Add is_pos_enabled column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'branches' AND column_name = 'is_pos_enabled') THEN
        ALTER TABLE branches ADD COLUMN is_pos_enabled BOOLEAN DEFAULT true;
    END IF;
    
    -- Add settings column (JSONB for custom settings)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'branches' AND column_name = 'settings') THEN
        ALTER TABLE branches ADD COLUMN settings JSONB DEFAULT '{}';
    END IF;
END $$;

-- Update existing branches: sync is_headquarters with is_office
UPDATE branches SET is_headquarters = is_office WHERE is_headquarters IS NULL OR is_headquarters = false;

-- Generate code for existing branches that don't have one
UPDATE branches SET code = 'BR' || SUBSTRING(id::TEXT, 1, 4) WHERE code IS NULL;

-- 2. FLOOR ZONES TABLE
-- Khu vực trong quán (Tầng 1, Sân vườn, VIP...)
CREATE TABLE IF NOT EXISTS floor_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                     -- "Tầng 1", "Sân vườn", "VIP"
  shape_type TEXT DEFAULT 'rectangle',   -- rectangle, circle, polygon
  shape_data JSONB DEFAULT '{}',          -- Tọa độ, kích thước, điểm polygon
  color TEXT DEFAULT '#3b82f6',           -- Màu hiển thị
  position_x FLOAT DEFAULT 0,             -- Vị trí X trên canvas
  position_y FLOAT DEFAULT 0,             -- Vị trí Y trên canvas
  width FLOAT DEFAULT 200,
  height FLOAT DEFAULT 150,
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. TABLES TABLE (renamed to pos_tables to avoid conflict with SQL keyword)
-- Bàn trong quán
CREATE TABLE IF NOT EXISTS pos_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  zone_id UUID REFERENCES floor_zones(id) ON DELETE SET NULL,
  table_number TEXT NOT NULL,             -- "1", "B1", "V2"
  name TEXT,                              -- Tên hiển thị tùy chọn
  seat_count INT DEFAULT 4,               -- Số chỗ ngồi
  table_type TEXT DEFAULT 'square',       -- square, round, long, sofa, bar_stool
  position_x FLOAT DEFAULT 0,             -- Vị trí X trong zone
  position_y FLOAT DEFAULT 0,             -- Vị trí Y trong zone
  width FLOAT DEFAULT 60,
  height FLOAT DEFAULT 60,
  rotation FLOAT DEFAULT 0,               -- Góc xoay (độ)
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(branch_id, table_number)
);

-- 4. USER_BRANCHES TABLE
-- Phân quyền user theo chi nhánh
CREATE TABLE IF NOT EXISTS user_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- Match users.id type (VARCHAR)
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  can_view_other_branches BOOLEAN DEFAULT false,  -- Xem tồn kho chi nhánh khác
  is_default BOOLEAN DEFAULT false,               -- Chi nhánh mặc định khi đăng nhập
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, branch_id)
);

-- 5. INDEXES
CREATE INDEX IF NOT EXISTS idx_floor_zones_branch ON floor_zones(branch_id);
CREATE INDEX IF NOT EXISTS idx_pos_tables_branch ON pos_tables(branch_id);
CREATE INDEX IF NOT EXISTS idx_pos_tables_zone ON pos_tables(zone_id);
CREATE INDEX IF NOT EXISTS idx_user_branches_user ON user_branches(user_id);
CREATE INDEX IF NOT EXISTS idx_user_branches_branch ON user_branches(branch_id);

-- 6. ROW LEVEL SECURITY
ALTER TABLE floor_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_branches ENABLE ROW LEVEL SECURITY;

-- Policies: Cho phép tất cả (security sẽ được check ở app level)
DROP POLICY IF EXISTS "Allow all for floor_zones" ON floor_zones;
DROP POLICY IF EXISTS "Allow all for pos_tables" ON pos_tables;
DROP POLICY IF EXISTS "Allow all for user_branches" ON user_branches;

CREATE POLICY "Allow all for floor_zones" ON floor_zones FOR ALL USING (true);
CREATE POLICY "Allow all for pos_tables" ON pos_tables FOR ALL USING (true);
CREATE POLICY "Allow all for user_branches" ON user_branches FOR ALL USING (true);

-- 7. TRIGGER: Update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Drop triggers if they exist before creating
DROP TRIGGER IF EXISTS update_floor_zones_updated_at ON floor_zones;
DROP TRIGGER IF EXISTS update_pos_tables_updated_at ON pos_tables;

CREATE TRIGGER update_floor_zones_updated_at
  BEFORE UPDATE ON floor_zones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pos_tables_updated_at
  BEFORE UPDATE ON pos_tables
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 8. COMMENTS
COMMENT ON TABLE floor_zones IS 'Khu vực trong quán (Tầng 1, Sân vườn, VIP...)';
COMMENT ON TABLE pos_tables IS 'Bàn trong quán, dùng cho POS chọn bàn';
COMMENT ON TABLE user_branches IS 'Phân quyền user theo chi nhánh';
COMMENT ON COLUMN branches.code IS 'Mã chi nhánh ngắn gọn (HQ, Q1, Q7...)';
COMMENT ON COLUMN branches.is_headquarters IS 'Chi nhánh chính/Trụ sở';
COMMENT ON COLUMN branches.is_warehouse IS 'Chi nhánh có kho hàng';
COMMENT ON COLUMN branches.is_pos_enabled IS 'Cho phép bán hàng POS';
