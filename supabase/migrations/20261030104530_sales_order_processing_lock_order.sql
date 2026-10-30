-- Serialize parent -> closure in both manual and automatic paths. Without this
-- order, an automatic INSERT can hold the marker while its parent FK waits on
-- a manual parent lock, and the manual path then waits on that same marker.
do $$
declare v_def text;
begin
  select pg_get_functiondef('public.remember_sales_order_processing_closed()'::regprocedure) into v_def;
  if position('and source=''order'' and deleted_at is null;' in v_def)=0 then
    raise exception 'Unexpected processing closure trigger definition';
  end if;
  v_def := replace(v_def,'and source=''order'' and deleted_at is null;',
    'and source=''order'' and deleted_at is null for no key update;');
  execute v_def;
end $$;
revoke all on function public.remember_sales_order_processing_closed() from public,anon,authenticated;
