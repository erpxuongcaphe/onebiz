-- Fix RLS policies for user_permissions table
-- The app uses custom authentication, not Supabase Auth, so auth.uid() won't work

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Admins can manage permission templates" ON permissions_template;
DROP POLICY IF EXISTS "Users can read own permissions" ON user_permissions;
DROP POLICY IF EXISTS "Admins can manage user permissions" ON user_permissions;

-- Create permissive policies (access control is handled at app level)
CREATE POLICY "Allow all access to permissions_template" ON permissions_template FOR ALL USING (true);
CREATE POLICY "Allow all access to user_permissions" ON user_permissions FOR ALL USING (true);
