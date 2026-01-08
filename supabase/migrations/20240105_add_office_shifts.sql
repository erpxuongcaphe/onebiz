-- ============================================
-- ADD DEFAULT BUSINESS HOURS SHIFTS
-- Run this script in Supabase SQL Editor
-- ============================================

-- Function to add office shifts if they don't exist
DO $$
DECLARE
    office_branch RECORD;
BEGIN
    FOR office_branch IN SELECT id FROM branches WHERE is_office = true
    LOOP
        -- Insert 'Hành chính' shift for Office (08:00 - 17:30)
        IF NOT EXISTS (
            SELECT 1 FROM shifts 
            WHERE branch_id = office_branch.id AND (name = 'Hành chính' OR name = 'Ca hành chính')
        ) THEN
            INSERT INTO shifts (branch_id, name, start_time, end_time, hourly_rate)
            VALUES (
                office_branch.id, 
                'Hành chính', 
                '08:00'::TIME, 
                '17:30'::TIME, 
                0 -- Often monthly salary, but rate can be set if needed
            );
        END IF;
    END LOOP;
END $$;

-- Update Store Shifts if needed or ensure they exist
-- (User mentioned Stores operate 06:00 - 22:00, usually broken into shifts, but we'll ensure at least the basic ones exist from previous migration)
-- The previous migration `20240103` already added Ca sáng, Ca chiều, Ca tối suitable for this range.
-- So we mainly focus on the Office shift here.
