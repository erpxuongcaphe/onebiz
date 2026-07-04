-- ============================================================
-- 00156 — Guard branch_stock base rows when variant_id IS NULL
-- ============================================================
-- Why:
--   PostgreSQL UNIQUE(branch_id, product_id, variant_id) allows multiple NULL
--   variant_id rows. That can create duplicate base stock rows for the same
--   tenant + branch + product, and the old upsert_branch_stock UPDATE then
--   increments every duplicate row.
--
-- Safe behaviour:
--   1. Consolidate duplicate base rows by SUM(quantity/reserved), keeping the
--      newest row as the canonical record. This preserves the current branch
--      total instead of deleting stock silently.
--   2. Add partial unique indexes for base rows and variant rows.
--   3. Rewrite upsert_branch_stock to use a single ON CONFLICT statement
--      targeting the base-row unique index.
--
-- Note:
--   This migration prevents future duplicate base rows. It does not decide
--   accounting truth if products.stock already drifted from branch_stock;
--   use verify_stock_invariants after running it to review remaining drift.
-- ============================================================

begin;

with duplicate_groups as (
  select
    tenant_id,
    branch_id,
    product_id,
    (array_agg(id order by updated_at desc nulls last, id desc))[1] as keep_id,
    sum(coalesce(quantity, 0)) as quantity,
    sum(coalesce(reserved, 0)) as reserved,
    max(updated_at) as updated_at,
    count(*) as row_count
  from public.branch_stock
  where variant_id is null
  group by tenant_id, branch_id, product_id
  having count(*) > 1
), updated_keep as (
  update public.branch_stock bs
     set quantity = dg.quantity,
         reserved = dg.reserved,
         updated_at = coalesce(dg.updated_at, now())
    from duplicate_groups dg
   where bs.id = dg.keep_id
  returning bs.id
)
delete from public.branch_stock bs
using duplicate_groups dg
where bs.tenant_id = dg.tenant_id
  and bs.branch_id = dg.branch_id
  and bs.product_id = dg.product_id
  and bs.variant_id is null
  and bs.id <> dg.keep_id;

create unique index if not exists idx_branch_stock_base_unique
  on public.branch_stock (tenant_id, branch_id, product_id)
  where variant_id is null;

create unique index if not exists idx_branch_stock_variant_unique
  on public.branch_stock (tenant_id, branch_id, product_id, variant_id)
  where variant_id is not null;

create or replace function public.upsert_branch_stock(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_product_id uuid,
  p_delta numeric
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_tenant_id is null or p_branch_id is null or p_product_id is null then
    raise exception 'upsert_branch_stock requires tenant_id, branch_id and product_id';
  end if;

  insert into public.branch_stock (
    tenant_id,
    branch_id,
    product_id,
    variant_id,
    quantity,
    reserved,
    updated_at
  ) values (
    p_tenant_id,
    p_branch_id,
    p_product_id,
    null,
    coalesce(p_delta, 0),
    0,
    now()
  )
  on conflict (tenant_id, branch_id, product_id) where variant_id is null
  do update
     set quantity = coalesce(public.branch_stock.quantity, 0) + coalesce(excluded.quantity, 0),
         updated_at = now();
end;
$$;

comment on function public.upsert_branch_stock(uuid, uuid, uuid, numeric) is
  'Atomic branch_stock base-row upsert. 00156: protected by partial unique index for variant_id IS NULL to prevent duplicate branch/product rows.';

grant execute on function public.upsert_branch_stock(uuid, uuid, uuid, numeric) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
