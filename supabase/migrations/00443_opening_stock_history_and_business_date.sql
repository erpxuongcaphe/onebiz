-- Complete the opening workflow without changing any existing inventory rows.
begin;
set local lock_timeout = '3s';
do $patch$
declare definition text; boundary text;
begin
  definition:=pg_get_functiondef('public.preview_inventory_opening_00442(jsonb)'::regprocedure);
  boundary:='reference_type not in (''initial_stock_opening'',''initial_stock_reset'',''initial_stock_import'')';
  if position(boundary in definition)=0 then raise exception 'OPENING_HISTORY_PATCH_BOUNDARY_CHANGED';end if;
  -- NULL is unknown operational history, not proof that a product is new.
  definition:=replace(definition,boundary,
    'coalesce(reference_type,'''') not in (''initial_stock_opening'',''initial_stock_reset'',''initial_stock_import'')');
  execute definition;

  definition:=pg_get_functiondef('public.commit_inventory_opening_00442(uuid,jsonb,jsonb,text,timestamptz,text,text)'::regprocedure);
  boundary:='''opening'',current_date,(v_row->>''expiryDate'')::date';
  if position(boundary in definition)=0 then raise exception 'OPENING_LOT_DATE_PATCH_BOUNDARY_CHANGED';end if;
  definition:=replace(definition,boundary,
    '''opening'',(now() at time zone ''Asia/Ho_Chi_Minh'')::date,(v_row->>''expiryDate'')::date');
  boundary:='(v_row->>''expiryDate'')::date<current_date';
  if position(boundary in definition)=0 then raise exception 'OPENING_EXPIRY_PATCH_BOUNDARY_CHANGED';end if;
  definition:=replace(definition,boundary,
    '(v_row->>''expiryDate'')::date<(now() at time zone ''Asia/Ho_Chi_Minh'')::date');
  execute definition;
end $patch$;
notify pgrst,'reload schema';
commit;
