#!/usr/bin/env node
/**
 * Create Admin Account Script
 *
 * Tạo tài khoản admin đầu tiên cho OneBiz ERP. Chạy 1 LẦN DUY NHẤT khi setup
 * môi trường. Admin được tạo có role='owner' → full bypass permission check.
 *
 * Yêu cầu:
 *   1. SUPABASE_URL — từ .env.local (NEXT_PUBLIC_SUPABASE_URL)
 *   2. SUPABASE_SERVICE_ROLE_KEY — lấy từ Supabase Dashboard → Settings → API
 *      → "service_role" key (GIỮ BÍ MẬT, KHÔNG commit vào git).
 *
 * Cách chạy:
 *   # Option 1: Truyền qua argv (nhanh, không lưu env)
 *   node scripts/create-admin.mjs <email> <password> [full_name] [store_name]
 *
 *   # Option 2: Set env var rồi chạy
 *   set SUPABASE_SERVICE_ROLE_KEY=eyJhbG...  (Windows cmd)
 *   $env:SUPABASE_SERVICE_ROLE_KEY="eyJhbG..."  (PowerShell)
 *   export SUPABASE_SERVICE_ROLE_KEY=eyJhbG...  (bash)
 *   node scripts/create-admin.mjs admin@onebiz.com.vn MyPassword123!
 *
 * Ví dụ:
 *   node scripts/create-admin.mjs admin@onebiz.com.vn SuperSecret123 "CEO OneBiz" "OneBiz Coffee"
 *
 * Sau khi chạy xong:
 *   - Login vào web với email + password vừa tạo
 *   - Trigger handle_new_user sẽ tự tạo tenant + branch + profile (role='owner')
 *   - Vào /cai-dat/phan-quyen → click "Tạo vai trò mặc định" để seed 7 roles
 *   - Vào /he-thong/users → "Mời nhân viên" để invite staff khác
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// ── Parse args ──
const [emailArg, passwordArg, fullNameArg, storeNameArg] = process.argv.slice(2);

if (!emailArg || !passwordArg) {
  console.error("❌ Thiếu tham số.");
  console.error("");
  console.error("Cách dùng:");
  console.error("  node scripts/create-admin.mjs <email> <password> [full_name] [store_name]");
  console.error("");
  console.error("Ví dụ:");
  console.error('  node scripts/create-admin.mjs admin@onebiz.com.vn "Pass123!" "CEO OneBiz" "OneBiz Coffee"');
  process.exit(1);
}

// ── Load Supabase URL from .env.local ──
function loadEnvVar(name) {
  try {
    const envPath = resolve(process.cwd(), ".env.local");
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...rest] = trimmed.split("=");
      if (key.trim() === name) return rest.join("=").trim();
    }
  } catch {
    // ignore
  }
  return process.env[name];
}

const SUPABASE_URL = loadEnvVar("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  console.error("❌ NEXT_PUBLIC_SUPABASE_URL không tìm thấy trong .env.local");
  process.exit(1);
}

if (!SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_SERVICE_ROLE_KEY chưa set. Lấy từ:");
  console.error("   Supabase Dashboard → Settings → API → service_role key");
  console.error("");
  console.error("Rồi chạy:");
  console.error('   (PowerShell)  $env:SUPABASE_SERVICE_ROLE_KEY="eyJhbG..."');
  console.error("   (Windows cmd) set SUPABASE_SERVICE_ROLE_KEY=eyJhbG...");
  console.error("   (bash)        export SUPABASE_SERVICE_ROLE_KEY=eyJhbG...");
  process.exit(1);
}

// ── Create admin ──
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const fullName = fullNameArg || "Admin OneBiz";
const storeName = storeNameArg || "OneBiz Coffee Chain";

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("OneBiz ERP — Tạo tài khoản admin đầu tiên");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`  URL:        ${SUPABASE_URL}`);
console.log(`  Email:      ${emailArg}`);
console.log(`  Full name:  ${fullName}`);
console.log(`  Store:      ${storeName}`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

// Check if user already exists
const { data: existingUsers, error: listErr } = await supabase.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
});

if (listErr) {
  console.error("❌ Không đọc được user list:", listErr.message);
  process.exit(1);
}

const existing = existingUsers.users.find(
  (u) => u.email?.toLowerCase() === emailArg.toLowerCase(),
);

if (existing) {
  console.log("");
  console.log(`⚠️  User "${emailArg}" ĐÃ TỒN TẠI (id: ${existing.id}).`);
  console.log("   Nếu muốn reset password, dùng Supabase Dashboard → Authentication → Users.");
  console.log("   Script này không override user có sẵn để tránh mất data.");
  process.exit(0);
}

const { data, error } = await supabase.auth.admin.createUser({
  email: emailArg,
  password: passwordArg,
  email_confirm: true, // Skip email verification
  user_metadata: {
    full_name: fullName,
    store_name: storeName,
  },
});

if (error) {
  console.error("");
  console.error("❌ Lỗi tạo admin:", error.message);
  console.error("");
  if (error.message.includes("already registered")) {
    console.error("   → Email này đã được dùng. Dùng email khác hoặc reset trong Dashboard.");
  }
  process.exit(1);
}

console.log("");
console.log("✅ Admin account đã tạo thành công!");
console.log("");
console.log(`   User ID:  ${data.user.id}`);
console.log(`   Email:    ${data.user.email}`);
console.log("");

// Verify profile was created by trigger
await new Promise((r) => setTimeout(r, 500));
const { data: profile, error: profileErr } = await supabase
  .from("profiles")
  .select("id, tenant_id, role, full_name, branch_id")
  .eq("id", data.user.id)
  .single();

if (profileErr || !profile) {
  console.warn("⚠️  Profile chưa thấy (trigger có thể chưa chạy xong).");
  console.warn("    Kiểm tra lại sau vài giây bằng:");
  console.warn(`    SELECT * FROM profiles WHERE id = '${data.user.id}';`);
} else {
  console.log("✅ Profile đã được trigger tạo:");
  console.log(`   Tenant ID:   ${profile.tenant_id}`);
  console.log(`   Branch ID:   ${profile.branch_id ?? "(chưa set)"}`);
  console.log(`   Role:        ${profile.role}`);
  console.log(`   Full name:   ${profile.full_name}`);
}

console.log("");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("BƯỚC TIẾP THEO:");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`  1. Mở web (VD http://localhost:3000) → trang /dang-nhap`);
console.log(`  2. Đăng nhập với email + password vừa nhập`);
console.log(`  3. Vào /cai-dat/phan-quyen → click "Tạo vai trò mặc định"`);
console.log(`  4. Vào /he-thong/users → "Mời nhân viên" để invite staff`);
console.log("");
console.log("  KHUYẾN CÁO BẢO MẬT:");
console.log("  → Sau khi xong, vào Supabase Dashboard → Authentication → Providers");
console.log("    → TẮT 'Enable Sign Up' để không ai tự đăng ký được nữa.");
console.log("");
