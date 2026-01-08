-- Fix RLS policies for salary_configs
-- The previous policies relied on auth.uid() which is not set in the current custom auth implementation
-- We will relax the policies to allow the application to function until full Auth migration

-- Drop strict policies
DROP POLICY IF EXISTS "salary_configs_admin_manage" ON salary_configs;
DROP POLICY IF EXISTS "salary_configs_insert" ON salary_configs;
DROP POLICY IF EXISTS "salary_configs_update" ON salary_configs;
DROP POLICY IF EXISTS "salary_configs_delete" ON salary_configs;

-- Create permissive policies (matching the current application security model)
-- Enable full access for all operations
CREATE POLICY "salary_configs_full_access" ON salary_configs
    FOR ALL
    USING (true)
    WITH CHECK (true);
