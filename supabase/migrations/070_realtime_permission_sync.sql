-- Migration 070: Add Realtime sync for permission changes
-- This enables real-time permission updates without requiring re-login

-- Function to notify permission changes via pg_notify
-- This triggers Supabase Realtime to broadcast the change
CREATE OR REPLACE FUNCTION public.notify_permission_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Notify all connected clients that permissions changed for this user
  PERFORM pg_notify(
    'permission_change',
    json_build_object(
      'user_id', COALESCE(NEW.user_id, OLD.user_id),
      'event', TG_OP,
      'timestamp', now()
    )::text
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Trigger on user_roles table to broadcast permission changes
CREATE TRIGGER notify_permission_change_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.notify_permission_change();

-- Enable Realtime for user_roles table (required for postgres_changes subscription)
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_roles;

-- Grant necessary permissions for Realtime
GRANT SELECT ON public.user_roles TO authenticated;

COMMENT ON FUNCTION public.notify_permission_change() IS
'Broadcasts permission changes via Realtime when user_roles table changes.
This allows frontend to update permissions without re-login.';

COMMENT ON TRIGGER notify_permission_change_trigger ON public.user_roles IS
'Triggers real-time permission sync when user roles are assigned/removed.';
