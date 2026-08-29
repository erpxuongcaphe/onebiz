-- 00359: Reconcile legacy duplicate defaults in single-choice modifier groups.
-- Future writes are already serialized by 00347/00349. This migration only
-- heals rows that existed before those guards were installed.

begin;

with ranked_defaults as (
  select
    o.id,
    row_number() over (
      partition by o.group_id
      order by o.sort_order desc, o.id desc
    ) as default_rank
  from public.modifier_options o
  join public.modifier_groups g on g.id = o.group_id
  where o.is_active
    and o.is_default
    and g.rule in ('single', 'single_required')
), duplicate_defaults as (
  select id
  from ranked_defaults
  where default_rank > 1
)
update public.modifier_options o
set is_default = false,
    updated_at = now()
from duplicate_defaults d
where o.id = d.id;

commit;

notify pgrst, 'reload schema';
