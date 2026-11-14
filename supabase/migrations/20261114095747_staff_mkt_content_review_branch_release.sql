-- History marker recorded by the management API after the preceding migration.
do $$begin
 if not exists(select 1 from public.staff_branch_permission_catalog where permission_code='mkt.review_content')
   or to_regprocedure('public.mkt_reviewable_content_ids(uuid[])') is null then
  raise exception 'MKT_REVIEW_RELEASE_INCOMPLETE';
 end if;
end$$;
