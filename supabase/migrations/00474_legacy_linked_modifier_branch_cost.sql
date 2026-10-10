-- Preserve deployed receipt/production logic; include legacy linked modifiers
-- in the same invoice cost snapshot as their actual material movement.
begin;
set local lock_timeout='3s';
do $patch$
declare d text; anchor text:=$old$elsif new.reference_type = 'bom_consume' and new.type = 'out' then$old$;
 arg text:=$old$'bom_consume', new.reference_type, new.reference_id$old$;
begin
 d:=pg_get_functiondef('public._capture_fnb_branch_cost_stock_movement_00390()'::regprocedure);
 if strpos(d,anchor)=0 or strpos(d,arg)=0 then raise exception 'LINKED_MODIFIER_COST_PATCH_MISMATCH'; end if;
 d:=replace(d,anchor,$new$elsif new.reference_type in ('bom_consume','modifier_topping') and new.type = 'out' then$new$);
 -- Keep the actual stock movement ID and note. The invoice cost grouping key
 -- must include linked modifiers so line snapshots and void restoration agree.
 d:=replace(d,arg,$new$'bom_consume', 'bom_consume', new.reference_id$new$);
 execute d;
end; $patch$;
commit;
