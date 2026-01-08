-- ============================================
-- QR ATTENDANCE FEATURE - STEP 1
-- Thêm qr_token vào bảng branches
-- ============================================

-- Thêm cột qr_token vào bảng branches
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'branches' AND column_name = 'qr_token') THEN
        ALTER TABLE branches ADD COLUMN qr_token VARCHAR(64) UNIQUE;
    END IF;
END $$;

-- Tạo token cho các chi nhánh hiện có (nếu chưa có)
UPDATE branches 
SET qr_token = encode(gen_random_bytes(32), 'hex')
WHERE qr_token IS NULL;

-- Đảm bảo các chi nhánh mới sẽ tự động có token
-- (Sẽ được xử lý ở application layer khi tạo chi nhánh mới)

-- Tạo index cho qr_token để tìm kiếm nhanh
CREATE INDEX IF NOT EXISTS idx_branches_qr_token ON branches(qr_token);
