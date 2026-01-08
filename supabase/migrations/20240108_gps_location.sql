-- Migration: Add GPS location fields to branches for attendance validation
-- This enables location-based check-in verification

ALTER TABLE branches 
ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS radius INTEGER DEFAULT 50;

-- Add comments for documentation
COMMENT ON COLUMN branches.latitude IS 'Vĩ độ của chi nhánh (Latitude)';
COMMENT ON COLUMN branches.longitude IS 'Kinh độ của chi nhánh (Longitude)';
COMMENT ON COLUMN branches.radius IS 'Bán kính cho phép chấm công (mét), mặc định 50m';
