-- 00356 postflight (CHỈ ĐỌC).
-- ĐẠT khi K1-K4 đều true. I1 chỉ đối chiếu số liên kết, không phải lỗi.

with target as (
  select to_regprocedure(
    'public.save_product_modifier_groups_atomic(uuid,uuid[])'
  ) as oid
), definition as (
  select coalesce(pg_get_functiondef(oid), '') as body from target
), checks as (
  select
    'K1_HAM_DUNG_CHU_KY_VA_DEFINER'::text as muc,
    'DIEU_KIEN'::text as loai,
    exists (
      select 1
        from pg_proc p
       where p.oid = (select oid from target)
         and p.prosecdef
         and pg_get_userbyid(p.proowner) = 'postgres'
    ) as dat,
    jsonb_build_object('chu_ky', 'save_product_modifier_groups_atomic(uuid,uuid[])') as chi_tiet
  union all
  select
    'K2_CO_KHOA_TENANT_QUYEN_VA_KENH',
    'DIEU_KIEN',
    position('for update' in lower(body)) > 0
      and position('user_has_permission' in body) > 0
      and position('p.tenant_id = v_tenant' in body) > 0
      and position('g.channel in (''fnb'', ''all'')' in body) > 0,
    jsonb_build_object('marker', 'FOR UPDATE + products.edit + tenant + fnb/all')
  from definition
  union all
  select
    'K3_THAY_DANH_SACH_TRONG_MOT_GIAO_DICH',
    'DIEU_KIEN',
    position('delete from public.product_modifier_groups' in body) > 0
      and position('insert into public.product_modifier_groups' in body) > 0,
    jsonb_build_object('marker', 'delete + insert trong mot RPC')
  from definition
  union all
  select
    'K4_QUYEN_GOI',
    'DIEU_KIEN',
    not has_function_privilege('anon', 'public.save_product_modifier_groups_atomic(uuid,uuid[])', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.save_product_modifier_groups_atomic(uuid,uuid[])', 'EXECUTE'),
    jsonb_build_object(
      'anon', has_function_privilege('anon', 'public.save_product_modifier_groups_atomic(uuid,uuid[])', 'EXECUTE'),
      'ghi_chu_public', 'anon=false cũng chứng minh không còn grant PUBLIC hiệu lực',
      'authenticated', has_function_privilege('authenticated', 'public.save_product_modifier_groups_atomic(uuid,uuid[])', 'EXECUTE')
    )
  union all
  select
    'I1_THONG_TIN_LIEN_KET_HIEN_CO',
    'THONG_TIN',
    null::boolean,
    jsonb_build_object(
      'tong_lien_ket', count(*),
      'so_mon_override', count(distinct product_id)
    )
  from public.product_modifier_groups
)
select muc, loai, dat, chi_tiet from checks order by muc;
