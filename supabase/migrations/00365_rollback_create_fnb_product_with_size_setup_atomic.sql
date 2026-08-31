begin;

drop function if exists public.create_fnb_product_with_size_setup_atomic(jsonb,jsonb,uuid[]);

commit;

notify pgrst, 'reload schema';
