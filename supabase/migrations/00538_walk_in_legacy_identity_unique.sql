begin;
-- The unique index also covers legacy inserts, independently of SELECT RLS.
create unique index customers_one_walk_in_identity_per_tenant
  on public.customers(tenant_id) where is_walk_in or code='KL-VL';
commit;
