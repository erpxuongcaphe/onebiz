-- Sweetness annotations cannot use the legacy topping-product consumption path.
begin;
do $patch$
declare definition text; needle text:=$needle$    for v_sel in select * from jsonb_array_elements(p_modifier_selections) loop
      for v_opt$needle$;
replacement text:=$replacement$    for v_sel in select * from jsonb_array_elements(p_modifier_selections) loop
      -- sweetness_note_topping_guard_00545: only explicit BOM quantities affect sweetness stock.
      if exists(select 1 from public.modifier_groups g where g.id::text=v_sel->>'groupId'
        and g.tenant_id=p_tenant_id and (lower(trim(g.name)) like 'mức đường%' or lower(trim(g.name)) like 'mức ngọt%')) then continue; end if;
      for v_opt$replacement$;
begin
 select pg_get_functiondef('public.consume_bom_for_sale(uuid,uuid,uuid,numeric,uuid,uuid,text,jsonb,boolean,uuid)'::regprocedure) into definition;
 if position('sweetness_note_topping_guard_00545' in definition)=0 then
 if position('explicit_sweetness_00544' in definition)=0 or position(needle in definition)=0 then raise exception '00545 unexpected consume function';end if;
 execute replace(definition,needle,replacement);
 end if;
end $patch$;
commit;
