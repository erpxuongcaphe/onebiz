// =====================================================
// Edge Function: Admin Create User
// Purpose: Securely create auth.users + profiles + assign roles
// Requires: Supabase Service Role Key
// =====================================================

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateUserRequest {
  email: string;
  password: string;
  full_name: string;
  phone?: string;
  tenant_id: string;
  branch_id?: string;
  role_ids?: string[];
}

interface CreateUserResponse {
  success: boolean;
  user_id?: string;
  email?: string;
  error?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get Supabase URL and Service Role Key from environment
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables');
    }

    // Create admin client with service role key
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Verify caller is authenticated
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get caller's user info
    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !caller) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid authentication token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify caller has users.manage permission
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('tenant_id')
      .eq('id', caller.id)
      .single();

    if (!callerProfile) {
      return new Response(
        JSON.stringify({ success: false, error: 'Caller profile not found' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check permission via RPC (with caller's tenant context)
    const { data: hasPermission } = await supabaseAdmin.rpc('has_permission', {
      permission: 'users.manage',
    });

    if (!hasPermission) {
      return new Response(
        JSON.stringify({ success: false, error: 'Không có quyền tạo user' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const requestData: CreateUserRequest = await req.json();
    const { email, password, full_name, phone, tenant_id, branch_id, role_ids } = requestData;

    // Validate required fields
    if (!email || !password || !full_name || !tenant_id) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing required fields: email, password, full_name, tenant_id',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate email format
    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Email không hợp lệ' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate password strength (min 8 chars)
    if (password.length < 8) {
      return new Response(
        JSON.stringify({ success: false, error: 'Mật khẩu phải có ít nhất 8 ký tự' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate tenant_id matches caller's tenant (prevent cross-tenant user creation)
    if (tenant_id !== callerProfile.tenant_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Không thể tạo user cho tenant khác' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate phone format (if provided)
    if (phone) {
      const phoneRegex = /^\+?[0-9]{10,12}$/;
      if (!phoneRegex.test(phone)) {
        return new Response(
          JSON.stringify({ success: false, error: 'Số điện thoại không hợp lệ' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check phone uniqueness
      const { data: existingPhone } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('tenant_id', tenant_id)
        .eq('phone', phone)
        .single();

      if (existingPhone) {
        return new Response(
          JSON.stringify({ success: false, error: 'Số điện thoại đã được sử dụng' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Validate branch_id (if provided)
    if (branch_id) {
      const { data: branch } = await supabaseAdmin
        .from('branches')
        .select('id')
        .eq('id', branch_id)
        .eq('tenant_id', tenant_id)
        .single();

      if (!branch) {
        return new Response(
          JSON.stringify({ success: false, error: 'Chi nhánh không tồn tại' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Validate role_ids (if provided)
    if (role_ids && role_ids.length > 0) {
      const { data: roles } = await supabaseAdmin
        .from('roles')
        .select('id')
        .eq('tenant_id', tenant_id)
        .in('id', role_ids);

      if (!roles || roles.length !== role_ids.length) {
        return new Response(
          JSON.stringify({ success: false, error: 'Một hoặc nhiều role không hợp lệ' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Step 1: Create auth.users using Admin API
    const { data: authUser, error: createAuthError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        full_name,
      },
    });

    if (createAuthError) {
      console.error('Auth user creation error:', createAuthError);
      return new Response(
        JSON.stringify({
          success: false,
          error: createAuthError.message || 'Failed to create auth user',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!authUser || !authUser.user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Auth user creation returned null' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const newUserId = authUser.user.id;

    try {
      // Step 2: Create profile
      const { error: profileError } = await supabaseAdmin.from('profiles').insert({
        id: newUserId,
        tenant_id,
        email,
        full_name,
        phone: phone || null,
        branch_id: branch_id || null,
        status: 'active',
      });

      if (profileError) {
        console.error('Profile creation error:', profileError);
        // Rollback: Delete auth user
        await supabaseAdmin.auth.admin.deleteUser(newUserId);
        return new Response(
          JSON.stringify({
            success: false,
            error: `Profile creation failed: ${profileError.message}`,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Step 3: Assign roles (if provided)
      if (role_ids && role_ids.length > 0) {
        const userRoles = role_ids.map((roleId) => ({
          user_id: newUserId,
          role_id: roleId,
          tenant_id,
          assigned_by: caller.id,
        }));

        const { error: rolesError } = await supabaseAdmin.from('user_roles').insert(userRoles);

        if (rolesError) {
          console.error('Role assignment error:', rolesError);
          // Don't rollback - roles can be assigned later
          // Just log the error
        }
      }

      // Success response
      return new Response(
        JSON.stringify({
          success: true,
          user_id: newUserId,
          email,
        } as CreateUserResponse),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      console.error('User creation error:', error);
      // Rollback: Delete auth user
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      return new Response(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('Edge function error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
