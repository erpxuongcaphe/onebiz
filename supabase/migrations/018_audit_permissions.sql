-- OneBiz ERP - Add audit permissions to roles

-- Allow Admin to read audit logs
update public.roles
set permissions = (
  case
    when permissions ? 'audit.read' then permissions
    else permissions || '"audit.read"'::jsonb
  end
)
where is_system = true and name = 'Admin';

-- Allow Manager to read audit logs (optional, safe default off)
-- Uncomment if desired.
-- update public.roles
-- set permissions = (
--   case
--     when permissions ? 'audit.read' then permissions
--     else permissions || '"audit.read"'::jsonb
--   end
-- )
-- where is_system = true and name = 'Manager';
