-- Keep the Retail internal POS note field exclusively for staff input.
-- Only the newly created pair of documents is updated by checkout.
begin;
set local lock_timeout = '3s';
do $patch$
declare
 target regprocedure := 'public.checkout_internal_pos_v2(jsonb)'::regprocedure;
 definition text := replace(pg_get_functiondef(target), E'\r\n', E'\n');
 old_invoice text := ' update invoices set subtotal=v_subtotal,';
 new_invoice text := $new$ -- retail_internal_staff_notes_00575
 update invoices set note=case when btrim(coalesce(p_checkout->>'note',''))='' then null else p_checkout->>'note' end,subtotal=v_subtotal,$new$;
 old_input text := ' update input_invoices set total_amount=v_total,tax_amount=v_tax where id=v_input;';
 new_input text := $new$ update input_invoices set note=case when btrim(coalesce(p_checkout->>'note',''))='' then null else p_checkout->>'note' end,total_amount=v_total,tax_amount=v_tax where id=v_input;$new$;
begin
 if position('retail_internal_staff_notes_00575' in definition) > 0 then return; end if;
 new_invoice := replace(new_invoice, E'\r\n', E'\n');
 if (length(definition)-length(replace(definition,old_invoice,'')))/length(old_invoice) <> 1
  or (length(definition)-length(replace(definition,old_input,'')))/length(old_input) <> 1 then
  raise exception 'RETAIL_INTERNAL_00575_NOTE_ANCHOR_CHANGED';
 end if;
 execute replace(replace(definition,old_invoice,new_invoice),old_input,new_input);
end $patch$;
notify pgrst,'reload schema';
commit;
