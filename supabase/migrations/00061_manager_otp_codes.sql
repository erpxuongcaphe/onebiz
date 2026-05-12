-- ============================================================
-- 00061: Manager OTP — duyệt từ xa (CEO 12/05/2026)
--
-- Use case: cashier muốn xoá bill / xoá món / giảm giá ngoài phạm vi
-- nhưng quản lý không có mặt tại quán. Manager mở web onebiz.com.vn/manager
-- → bấm "Cấp OTP" → app sinh mã 6 số TTL 2 phút → manager đọc qua điện thoại
-- → cashier nhập vào POS để duyệt.
--
-- 6 action cần OTP (CEO chốt 12/05):
--   1. fnb.cancel_unpaid_bill   — Xoá bill chưa thanh toán
--   2. fnb.cancel_unpaid_item   — Xoá món chưa thanh toán
--   3. fnb.discount_override    — Giảm giá ngoài phạm vi
--   4. fnb.void_paid_bill       — Hủy bill đã thanh toán
--   5. fnb.edit_sent_order      — Sửa món đã gửi bếp
--   6. crm.delete_party         — Xoá khách hàng / NCC
--
-- Bảo mật:
--   - Code hash bằng pgcrypto digest('sha256') + salt (tenant_id, issued_by)
--   - TTL 2 phút (expires_at), dùng 1 lần (used_at), row lock chống race
--   - Rate limit ở service: 5 issue/15 phút/manager + 10 verify fail trước
--     khi báo admin (không khoá — CEO yêu cầu chưa cần khóa)
-- ============================================================

create extension if not exists "pgcrypto";

-- 1. Bảng lưu OTP đã cấp
create table if not exists public.manager_otp_codes (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  -- Hash code 6 số bằng sha256( code || ':' || tenant_id || ':' || issued_by )
  -- Không reversible. Verify bằng cách recompute hash + compare.
  code_hash text not null,
  issued_by uuid not null references public.profiles(id) on delete set null,
  action_code text not null,  -- 'fnb.cancel_unpaid_bill', 'fnb.discount_override', ...
  target_meta jsonb not null default '{}',  -- {bill_id, percent, item_id, ...}
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references public.profiles(id) on delete set null,
  used_for_target jsonb,  -- snapshot target khi verify (để audit log)
  created_at timestamptz not null default now()
);

create index if not exists idx_manager_otp_tenant_action
  on public.manager_otp_codes(tenant_id, action_code, expires_at desc);

create index if not exists idx_manager_otp_issuer_created
  on public.manager_otp_codes(tenant_id, issued_by, created_at desc);

-- Cleanup index cho job xoá OTP cũ (>24h)
create index if not exists idx_manager_otp_cleanup
  on public.manager_otp_codes(expires_at)
  where used_at is null;

alter table public.manager_otp_codes enable row level security;

drop policy if exists "manager_otp_select_own_tenant" on public.manager_otp_codes;
create policy "manager_otp_select_own_tenant" on public.manager_otp_codes
  for select using (tenant_id = public.get_user_tenant_id());

-- Insert chỉ qua RPC (không cho client trực tiếp insert để tránh tự sinh OTP giả)
drop policy if exists "manager_otp_no_direct_insert" on public.manager_otp_codes;
create policy "manager_otp_no_direct_insert" on public.manager_otp_codes
  for insert with check (false);

comment on table public.manager_otp_codes is
  'OTP 6 số TTL 2 phút cho manager duyệt từ xa các action nhạy cảm POS. Code hash sha256, dùng 1 lần.';

-- 2. Helper hash function — dùng chung issue + verify
create or replace function public.hash_manager_otp(
  p_code text,
  p_tenant_id uuid,
  p_issued_by uuid
) returns text
language sql
immutable
as $$
  select encode(
    digest(
      p_code || ':' || p_tenant_id::text || ':' || p_issued_by::text,
      'sha256'
    ),
    'hex'
  );
$$;

-- 3. RPC sinh OTP — chỉ user có quyền tương ứng action mới cấp được
create or replace function public.issue_manager_otp(
  p_action_code text,
  p_target_meta jsonb default '{}'::jsonb,
  p_branch_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_required_perm text;
  v_code text;
  v_hash text;
  v_otp_id uuid;
  v_expires_at timestamptz := now() + interval '2 minutes';
  v_recent_count int;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED: please sign in';
  end if;

  select id, tenant_id, branch_id, full_name, role
  into v_profile
  from public.profiles
  where id = v_actor
    and is_active = true;

  if not found then
    raise exception 'USER_PROFILE_NOT_FOUND: %', v_actor;
  end if;

  -- Map action_code -> permission code cần check để issue
  v_required_perm := case p_action_code
    when 'fnb.cancel_unpaid_bill'   then 'pos_fnb.cancel_unpaid_order'
    when 'fnb.cancel_unpaid_item'   then 'pos_fnb.cancel_unpaid_order'
    when 'fnb.discount_override'    then 'pos_fnb.discount'
    when 'fnb.void_paid_bill'       then 'pos_fnb.void_paid_bill'
    when 'fnb.edit_sent_order'      then 'pos_fnb.edit_sent_order'
    when 'crm.delete_party'         then 'customers.delete'  -- dùng chung cho KH/NCC
    else null
  end;

  if v_required_perm is null then
    raise exception 'UNKNOWN_ACTION_CODE: %', p_action_code;
  end if;

  if not public.user_has_permission(v_actor, v_required_perm) then
    raise exception 'PERMISSION_DENIED: cần quyền % để cấp OTP cho action %',
      v_required_perm, p_action_code;
  end if;

  -- Rate limit: 1 manager không được cấp > 5 OTP/15 phút
  -- (chống spam OTP gây phiền cashier hoặc test brute force).
  select count(*) into v_recent_count
  from public.manager_otp_codes
  where tenant_id = v_profile.tenant_id
    and issued_by = v_actor
    and created_at > now() - interval '15 minutes';

  if v_recent_count >= 5 then
    raise exception 'RATE_LIMIT_EXCEEDED: bạn đã cấp 5 OTP trong 15 phút qua, vui lòng đợi';
  end if;

  -- Sinh mã 6 số random 000000-999999
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  v_hash := public.hash_manager_otp(v_code, v_profile.tenant_id, v_actor);

  insert into public.manager_otp_codes (
    tenant_id, branch_id, code_hash, issued_by,
    action_code, target_meta, expires_at
  ) values (
    v_profile.tenant_id, coalesce(p_branch_id, v_profile.branch_id),
    v_hash, v_actor,
    p_action_code, coalesce(p_target_meta, '{}'::jsonb), v_expires_at
  )
  returning id into v_otp_id;

  return jsonb_build_object(
    'success', true,
    'otp_id', v_otp_id,
    'code', v_code,   -- chỉ lần sinh thấy plain text
    'expires_at', v_expires_at,
    'expires_in_seconds', 120,
    'action_code', p_action_code,
    'issued_by_name', v_profile.full_name
  );
end;
$$;

comment on function public.issue_manager_otp is
  'Sinh OTP 6 số TTL 2 phút cho manager duyệt từ xa. Permission gate per action + rate limit 5/15min.';

-- 4. RPC verify + đánh dấu OTP đã dùng (atomic, race-safe)
create or replace function public.verify_and_use_manager_otp(
  p_code text,
  p_action_code text,
  p_target_meta jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_otp record;
  v_issuer_profile record;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_code is null or length(p_code) <> 6 or p_code !~ '^[0-9]{6}$' then
    raise exception 'INVALID_OTP_FORMAT: phải là 6 chữ số';
  end if;

  select id, tenant_id, branch_id
  into v_profile
  from public.profiles
  where id = v_actor
    and is_active = true;

  if not found then
    raise exception 'USER_PROFILE_NOT_FOUND';
  end if;

  -- Tìm OTP còn hiệu lực: cùng tenant + action + chưa dùng + chưa hết hạn
  -- Hash phụ thuộc issued_by → phải JOIN trên hash recompute cho TỪNG issuer
  -- để tránh tốn full table scan. Cách hiệu quả: lock SELECT WHERE
  -- code_hash = hash(p_code, tenant, issued_by) trên tất cả issuer có rows
  -- chưa dùng trong action đó.
  select o.*, p.full_name as issuer_name
  into v_otp
  from public.manager_otp_codes o
  join public.profiles p on p.id = o.issued_by
  where o.tenant_id = v_profile.tenant_id
    and o.action_code = p_action_code
    and o.used_at is null
    and o.expires_at > now()
    and o.code_hash = public.hash_manager_otp(p_code, o.tenant_id, o.issued_by)
  order by o.created_at desc
  limit 1
  for update of o skip locked;

  if not found then
    raise exception 'OTP_INVALID_OR_EXPIRED: mã không đúng, hết hạn, hoặc đã được dùng';
  end if;

  -- Mark used atomic
  update public.manager_otp_codes
  set used_at = now(),
      used_by = v_actor,
      used_for_target = p_target_meta
  where id = v_otp.id;

  return jsonb_build_object(
    'success', true,
    'otp_id', v_otp.id,
    'action_code', p_action_code,
    'issued_by', v_otp.issued_by,
    'issued_by_name', v_otp.issuer_name,
    'issued_at', v_otp.created_at,
    'used_at', now()
  );
end;
$$;

comment on function public.verify_and_use_manager_otp is
  'Verify OTP + đánh dấu used trong cùng transaction. Row lock skip locked race-safe.';

-- 5. RPC list OTP gần nhất của manager (cho UI history)
create or replace function public.get_recent_manager_otps(
  p_limit int default 10
) returns table (
  id uuid,
  action_code text,
  target_meta jsonb,
  created_at timestamptz,
  expires_at timestamptz,
  used_at timestamptz,
  used_by_name text,
  is_expired boolean,
  is_used boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.id,
    o.action_code,
    o.target_meta,
    o.created_at,
    o.expires_at,
    o.used_at,
    used_p.full_name as used_by_name,
    (o.expires_at <= now() and o.used_at is null) as is_expired,
    (o.used_at is not null) as is_used
  from public.manager_otp_codes o
  left join public.profiles used_p on used_p.id = o.used_by
  where o.tenant_id = public.get_user_tenant_id()
    and o.issued_by = auth.uid()
  order by o.created_at desc
  limit greatest(coalesce(p_limit, 10), 1);
$$;

comment on function public.get_recent_manager_otps is
  'List OTP đã cấp bởi manager đang đăng nhập (cho tab History trang Manager).';

-- 6. Grants
grant execute on function public.issue_manager_otp(text, jsonb, uuid) to authenticated;
grant execute on function public.verify_and_use_manager_otp(text, text, jsonb) to authenticated;
grant execute on function public.get_recent_manager_otps(int) to authenticated;
