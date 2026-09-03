-- ============================================================================
-- 00371 - Chi RPC quan tri moi duoc thay doi pham vi chi nhanh cua nhan vien.
--
-- update_managed_user_atomic (00279) va initialize_managed_user_atomic (00280)
-- la SECURITY DEFINER, da khoa tenant + system.manage_users. Trinh duyet chi
-- can SELECT de hien thi; khong duoc INSERT/UPDATE/DELETE truc tiep.
-- ============================================================================

drop policy if exists "user_branches_insert" on public.user_branches;
drop policy if exists "user_branches_delete" on public.user_branches;
drop policy if exists "user_branches_update" on public.user_branches;

-- Supabase may have granted TRUNCATE/REFERENCES/TRIGGER together with CRUD.
-- Revoke the complete browser grant set, then restore the one required read.
revoke all privileges on table public.user_branches
  from public, anon, authenticated;
grant select on table public.user_branches to authenticated;

do $$
begin
  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'user_branches'
      and grantee in ('PUBLIC', 'anon', 'authenticated')
      and privilege_type <> 'SELECT'
  ) then
    raise exception '00371 that bai: user_branches van con quyen ghi truc tiep';
  end if;
  if to_regprocedure('public.update_managed_user_atomic(uuid,jsonb,uuid[])') is null
     or to_regprocedure('public.initialize_managed_user_atomic(uuid,text,text,text,uuid,uuid[])') is null then
    raise exception '00371 dung: thieu RPC quan tri user 00279/00280';
  end if;
end $$;

notify pgrst, 'reload schema';
