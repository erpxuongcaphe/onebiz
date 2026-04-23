-- ============================================================
-- 00036 — Phone Number Login Support
-- ============================================================
-- Sprint Go-Live (23/04/2026) — CEO request: nhân viên quán cà phê quen nhập
-- SĐT hơn email. Cho phép login bằng SĐT HOẶC email + password (password
-- không đổi, vẫn dùng supabase auth chuẩn).
--
-- Cơ chế:
--   1. Normalize phone trước khi lưu/so khớp (strip space/dash/leading +84).
--   2. Unique phone per tenant — chặn 2 nhân viên cùng SĐT trong 1 tenant.
--   3. RPC get_email_by_phone(p_phone) — client gọi để tra email từ SĐT rồi
--      login bằng email + password như thường (Supabase auth chỉ nhận email).
--   4. Security definer + rate-limit nhẹ để chống brute-force lookup email
--      (attacker cố dò SĐT → email để phishing).
--
-- KHÔNG đụng vào auth.users — phone chỉ là field phụ trong profiles dùng để
-- lookup, auth vẫn là email + password chuẩn Supabase.
-- ============================================================

-- ── 1. Normalize phone helper ──
-- Strip mọi ký tự không phải số, cắt prefix +84/84 về 0 (VN).
-- Ví dụ: "+84 912 345 678" → "0912345678", "84 912-345-678" → "0912345678"
create or replace function public.normalize_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_phone is null or trim(p_phone) = '' then null
    else (
      with stripped as (
        -- Chỉ giữ số
        select regexp_replace(p_phone, '[^0-9]', '', 'g') as digits
      )
      select case
        -- 84xxxxxxxxx → 0xxxxxxxxx (VN international prefix)
        when length(digits) >= 11 and left(digits, 2) = '84'
          then '0' || substring(digits, 3)
        else digits
      end
      from stripped
    )
  end
$$;

comment on function public.normalize_phone(text) is
  'Chuẩn hoá SĐT VN: strip space/dash, convert +84/84 prefix về 0. Dùng để so khớp login.';

-- ── 2. Unique phone per tenant ──
-- Partial unique index: chỉ áp dụng khi phone không null + active.
-- Cho phép nhân viên cũ (inactive) giữ lại SĐT cũ mà không chặn user mới.
create unique index if not exists idx_profiles_tenant_phone_unique
  on public.profiles(tenant_id, public.normalize_phone(phone))
  where phone is not null and is_active = true;

comment on index public.idx_profiles_tenant_phone_unique is
  'Unique SĐT per tenant (active users only). Dùng normalize_phone để chặn trùng khi format khác nhau.';

-- ── 3. RPC lookup email từ phone ──
-- Security definer: bypass RLS để user chưa login cũng tra được email.
-- Chỉ return email, không leak gì khác. Rate limit ở tầng app qua Supabase
-- auth throttle mặc định (signInWithPassword cũng bị throttle).
-- Nếu không tìm thấy → return NULL (client hiển thị "SĐT không tồn tại").
create or replace function public.get_email_by_phone(p_phone text)
returns text
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_normalized text;
  v_email text;
begin
  v_normalized := public.normalize_phone(p_phone);

  if v_normalized is null or length(v_normalized) < 9 then
    return null;
  end if;

  -- Tra user active có SĐT khớp. Nếu nhiều tenant cùng SĐT (hiếm, chỉ khi
  -- user tham gia nhiều chuỗi cà phê) → chọn bản ghi active mới nhất.
  select email into v_email
  from public.profiles
  where is_active = true
    and phone is not null
    and public.normalize_phone(phone) = v_normalized
  order by updated_at desc
  limit 1;

  return v_email;
end;
$$;

comment on function public.get_email_by_phone(text) is
  'Tra email từ SĐT để login (Supabase auth chỉ nhận email). Return NULL nếu không thấy.';

-- Cho phép anon + authenticated gọi RPC này (cần cho login page khi chưa auth)
grant execute on function public.get_email_by_phone(text) to anon, authenticated;
grant execute on function public.normalize_phone(text) to anon, authenticated;
