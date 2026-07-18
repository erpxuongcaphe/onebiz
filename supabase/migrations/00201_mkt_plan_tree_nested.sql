-- ============================================================
-- 00201: Cây kế hoạch LỒNG NHAU — tối đa 4 cấp, sâu bao nhiêu tùy từng kế hoạch
--
-- CEO 18/07 (chốt lần 2, thay khuôn cứng của 00200): các CẤP là do NGƯỜI LÀM
-- KẾ HOẠCH tự chia để quản lý, không phải hệ thống áp tên cứng "Kênh":
--
--   Kế hoạch cấp 1  = mkt_campaigns (Chiến dịch — giữ túi tiền, thời hạn, sẵn sàng)
--   Kế hoạch cấp 2  = mkt_campaign_plans có parent_plan_id NULL   (tự đặt tên)
--   Kế hoạch cấp 3  = mkt_campaign_plans có parent_plan_id → cấp 2 (tự đặt tên)
--   Kế hoạch phụ    = mkt_channel_work_packages (nơi CHỨA VIỆC — giữ nguyên
--                     trọn vòng nộp → duyệt → sinh việc → KPI → báo cáo)
--
-- "Tùy nhu cầu từng kế hoạch": Kế hoạch phụ gắn thẳng vào Chiến dịch (nông),
-- vào cấp 2, hoặc vào cấp 3 (sâu nhất) — mọi nhánh đều ≤ 4 cấp.
--
-- Kênh (website/facebook/tiktok…) KHÔNG còn là một tầng: thành NHÃN tùy chọn
-- trên Kế hoạch phụ (cột channel_type giữ nguyên, app hiển thị là nhãn).
-- "Kế hoạch phụ" 00199 (mkt_channel_plan_stages) đổi tên hiển thị thành
-- "Nhóm công đoạn" phía app — dữ liệu không đổi.
--
-- KHOÁ AN TOÀN (theo sổ bẫy):
--   • Trần 4 cấp chốt ở DB bằng trigger: cha phải là nút GỐC (cấp 2) → không
--     thể lồng quá cấp 3; nút đang có con không được tụt xuống làm con.
--   • Chống vòng: tự làm cha chính mình bị chặn; A↔B bất khả vì cha buộc là gốc.
--   • mkt_campaign_plan_upsert ĐỔI CHỮ KÝ (thêm p_parent_plan_id) → DROP +
--     tạo lại + grant lại (42P13). Thân chép nguyên văn 00200, chỉ thêm cột.
--   • Xoá một nút: kế hoạch con + Kế hoạch phụ NỐI LÊN nút ông (không mất gì,
--     không rơi về "chưa xếp" vô cớ). mkt_campaign_plan_delete cùng chữ ký →
--     create or replace là đủ.
--   • mkt_create_work_package / mkt_work_package_set_campaign_plan GIỮ NGUYÊN
--     (gắn vào nút cấp 2 hay cấp 3 đều hợp lệ, guard cùng chiến dịch có sẵn).
-- ============================================================

-- ── 1. Cột cha — bảng cấp 2 tự lồng thành cấp 2/3 ───────────────
alter table public.mkt_campaign_plans
  add column if not exists parent_plan_id uuid
    references public.mkt_campaign_plans(id) on delete set null;

create index if not exists idx_mkt_campaign_plans_parent
  on public.mkt_campaign_plans(parent_plan_id) where deleted_at is null;

-- ── 2. Luật lồng — trần 4 cấp chốt tại DB (hàm phụ riêng) ───────
create or replace function public.mkt_assert_campaign_plan_nesting()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_plan_id is null then
    return new;
  end if;
  if new.id is not null and new.parent_plan_id = new.id then
    raise exception 'PLAN_TREE_INVALID: kế hoạch không thể là cha của chính nó' using errcode = 'P0001';
  end if;
  -- Cha phải: cùng tenant + cùng chiến dịch, còn sống, và là nút GỐC (cấp 2).
  -- Nhờ vậy cây tối đa: Chiến dịch → cấp 2 → cấp 3 (không lồng sâu hơn).
  if not exists (
    select 1 from public.mkt_campaign_plans p
    where p.id = new.parent_plan_id
      and p.tenant_id = new.tenant_id
      and p.campaign_id = new.campaign_id
      and p.deleted_at is null
      and p.parent_plan_id is null
  ) then
    raise exception 'PLAN_TREE_INVALID: cha phải là Kế hoạch cấp 2 cùng chiến dịch (cây tối đa 4 cấp)' using errcode = 'P0001';
  end if;
  -- Nút đang có kế hoạch con (đang là cấp 2) mà tụt xuống làm con → con của nó
  -- thành cấp 4 middle, vượt trần. Chặn, báo rõ để người dùng dời con trước.
  if exists (
    select 1 from public.mkt_campaign_plans c
    where c.parent_plan_id = new.id and c.deleted_at is null
  ) then
    raise exception 'PLAN_TREE_INVALID: kế hoạch này đang có kế hoạch con — dời các kế hoạch con ra trước khi chuyển nó xuống cấp 3' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_mkt_campaign_plans_nesting on public.mkt_campaign_plans;
create trigger trg_mkt_campaign_plans_nesting
  before insert or update on public.mkt_campaign_plans
  for each row execute function public.mkt_assert_campaign_plan_nesting();

-- ── 3. Upsert — ĐỔI CHỮ KÝ (thêm p_parent_plan_id) ──────────────
-- Chép nguyên văn 00200; thêm parent (null = nút gốc cấp 2; luật lồng do trigger soi).
drop function if exists public.mkt_campaign_plan_upsert(uuid, uuid, text, text, uuid, date, date);

create or replace function public.mkt_campaign_plan_upsert(
  p_id uuid,
  p_campaign_id uuid,
  p_name text,
  p_objective text default null,
  p_owner_id uuid default null,
  p_timeframe_start date default null,
  p_timeframe_end date default null,
  p_parent_plan_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_campaign record;
  v_id uuid;
  v_sort integer;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'PLAN_VALIDATION_FAILED: kế hoạch chưa đặt tên' using errcode = 'P0001';
  end if;
  v_tenant := public.get_user_tenant_id();
  select * into v_campaign from public.mkt_campaigns where id = p_campaign_id and deleted_at is null;
  if not found or v_campaign.tenant_id <> v_tenant then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  if p_id is not null then
    -- 00201: p_parent_plan_id là giá trị MỚI của cha (app luôn gửi kèm giá trị
    -- hiện tại khi sửa — null nghĩa là nút gốc cấp 2). Trigger soi luật lồng.
    update public.mkt_campaign_plans set
      name = trim(p_name),
      objective = nullif(trim(coalesce(p_objective, '')), ''),
      owner_id = p_owner_id,
      timeframe_start = p_timeframe_start,
      timeframe_end = p_timeframe_end,
      parent_plan_id = p_parent_plan_id,
      updated_by = v_actor
    where id = p_id and campaign_id = p_campaign_id and tenant_id = v_tenant and deleted_at is null
    returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  else
    select coalesce(max(sort_order) + 1, 0) into v_sort
    from public.mkt_campaign_plans where campaign_id = p_campaign_id and deleted_at is null;
    insert into public.mkt_campaign_plans (
      tenant_id, campaign_id, name, objective, owner_id, timeframe_start, timeframe_end, sort_order, parent_plan_id, created_by, updated_by
    ) values (
      v_tenant, p_campaign_id, trim(p_name), nullif(trim(coalesce(p_objective, '')), ''),
      p_owner_id, p_timeframe_start, p_timeframe_end, v_sort, p_parent_plan_id, v_actor, v_actor
    ) returning id into v_id;
  end if;

  perform public.mkt_record_audit(v_tenant, v_actor, 'mkt_campaign_plan_upsert', 'mkt_campaign_plan', v_id, null, jsonb_build_object('name', trim(p_name), 'parent', p_parent_plan_id));
  return jsonb_build_object('success', true, 'campaignPlanId', v_id);
end;
$$;

-- ── 4. Xoá — con NỐI LÊN ông (chữ ký giữ nguyên → replace) ──────
create or replace function public.mkt_campaign_plan_delete(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_plan record;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then
    raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001';
  end if;
  v_tenant := public.get_user_tenant_id();
  select * into v_plan from public.mkt_campaign_plans where id = p_id and tenant_id = v_tenant and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  -- 00201: KHÔNG mất gì khi xoá một nút — mọi thứ bên trong nối lên nút ông.
  --   • Kế hoạch con (cấp 3) → lên thế chỗ (cha mới = cha của nút bị xoá;
  --     nút bị xoá là cấp 2 thì con thành cấp 2 gốc — trigger cho qua vì null).
  --   • Kế hoạch phụ (work package) → gắn lên nút ông (null = trực thuộc
  --     Chiến dịch); vòng kế hoạch/việc bên trong còn nguyên.
  update public.mkt_campaign_plans
  set parent_plan_id = v_plan.parent_plan_id, updated_by = v_actor
  where parent_plan_id = p_id and tenant_id = v_tenant and deleted_at is null;

  update public.mkt_channel_work_packages
  set campaign_plan_id = v_plan.parent_plan_id, updated_by = v_actor
  where campaign_plan_id = p_id and tenant_id = v_tenant;

  update public.mkt_campaign_plans set deleted_at = now(), updated_by = v_actor where id = p_id;

  perform public.mkt_record_audit(v_tenant, v_actor, 'mkt_campaign_plan_deleted', 'mkt_campaign_plan', p_id, to_jsonb(v_plan), null);
  return jsonb_build_object('success', true);
end;
$$;

-- ── 5. Quyền gọi hàm (chữ ký upsert MỚI 8 tham số) ──────────────
revoke all on function public.mkt_assert_campaign_plan_nesting() from public, anon, authenticated;
revoke all on function public.mkt_campaign_plan_upsert(uuid, uuid, text, text, uuid, date, date, uuid) from public, anon;
revoke all on function public.mkt_campaign_plan_delete(uuid) from public, anon;
grant execute on function public.mkt_campaign_plan_upsert(uuid, uuid, text, text, uuid, date, date, uuid) to authenticated;
grant execute on function public.mkt_campaign_plan_delete(uuid) to authenticated;

notify pgrst, 'reload schema';
