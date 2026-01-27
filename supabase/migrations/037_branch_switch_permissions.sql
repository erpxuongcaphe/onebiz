-- OneBiz ERP - Add branch.switch permission to roles

update public.roles
set permissions = (
  case
    when permissions ? 'branch.switch' then permissions
    else permissions || '["branch.switch"]'::jsonb
  end
)
where is_system = true and name in ('Admin', 'Manager', 'Cashier');
