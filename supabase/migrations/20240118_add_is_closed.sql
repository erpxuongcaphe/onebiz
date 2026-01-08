-- Add is_closed column to registration_settings
-- This allows managers to manually close registration early

ALTER TABLE registration_settings 
ADD COLUMN IF NOT EXISTS is_closed BOOLEAN DEFAULT false;

ALTER TABLE registration_settings 
ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

ALTER TABLE registration_settings 
ADD COLUMN IF NOT EXISTS closed_by TEXT;
