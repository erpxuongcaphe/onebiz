-- JSON null is an empty optional topping list, just like SQL NULL.
-- Preserve request snapshots/context hashes and all business rows.
begin;
set local lock_timeout='3s';
do $patch$
declare target regprocedure; definition text; before_definition text;
begin
 foreach target in array array[
  'public.fnb_pending_cancel_requests_00455()'::regprocedure,
  'public.fnb_execute_cancel_request_00455(uuid,uuid,uuid)'::regprocedure
 ] loop
  definition:=pg_get_functiondef(target);
  before_definition:=definition;
  definition:=replace(definition, 'coalesce(i.toppings,''[]'')', 'coalesce(nullif(i.toppings,''null''::jsonb),''[]''::jsonb)');
  definition:=replace(definition, 'coalesce(v->''toppings'',''[]'')', 'coalesce(nullif(v->''toppings'',''null''::jsonb),''[]''::jsonb)');
  definition:=replace(definition, 'coalesce(toppings,''[]'')', 'coalesce(nullif(toppings,''null''::jsonb),''[]''::jsonb)');
  if definition<>before_definition then execute definition;
  elsif position('nullif(' in definition)=0 then raise exception 'FNB_CANCEL_TOPPINGS_PATCH_TARGET_CHANGED: %',target;
  end if;
 end loop;
end $patch$;
notify pgrst,'reload schema';
commit;
