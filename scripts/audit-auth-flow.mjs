#!/usr/bin/env node
/**
 * audit-auth-flow.mjs — Đánh giá khách quan luồng đăng nhập trên prod.
 *
 * CEO 09/06/2026: verify fix login bug "phải clear cache mới vào được"
 * mà KHÔNG cần tài khoản CEO (tránh false-positive do TK CEO vốn luôn vào).
 *
 * Chạy: node scripts/audit-auth-flow.mjs
 * Test ở tầng HTTP (server) — đo response thật từ Vercel + Supabase.
 */

const BASE = "https://onebiz.com.vn";
const results = [];
let pass = 0;
let fail = 0;

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (ok) pass++;
  else fail++;
  const tag = ok ? "✅ PASS" : "❌ FAIL";
  console.log(`${tag}  ${name}`);
  if (detail) console.log(`        ↳ ${detail}`);
}

async function timed(fn) {
  const t0 = Date.now();
  const r = await fn();
  return { ...r, ms: Date.now() - t0 };
}

// Garbage refresh token mô phỏng "Already Used"
const GARBAGE = "base64-" + Buffer.from(
  JSON.stringify({ access_token: "GARBAGE", refresh_token: "ALREADY_USED_FAKE", expires_at: 1 })
).toString("base64");
const COOKIE_NAME = "sb-nppumpxtjoirwhwgbvoo-auth-token";

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log(" AUDIT LUỒNG ĐĂNG NHẬP — " + BASE);
  console.log(" Thời điểm: " + new Date().toISOString());
  console.log("═══════════════════════════════════════════════════════\n");

  // ── TEST 1: /dang-nhap có inline script auto-clear chưa ──
  try {
    const res = await timed(async () => {
      const r = await fetch(`${BASE}/dang-nhap`, { redirect: "manual" });
      const body = await r.text();
      return { status: r.status, body };
    });
    const hasClearScript = res.body.includes("/auth/v1/token") &&
      res.body.includes("isLoginPage") &&
      res.body.includes("sb-");
    check(
      "T1. Trang /dang-nhap chứa inline script auto-clear",
      hasClearScript,
      hasClearScript
        ? `Có đủ marker (isLoginPage + clear sb-* + monkey-patch fetch), load ${res.ms}ms`
        : "THIẾU inline script — fix chưa deploy!"
    );
  } catch (e) {
    check("T1. Trang /dang-nhap chứa inline script", false, String(e));
  }

  // ── TEST 2: Login sai → phản hồi lỗi SẠCH (4xx), KHÔNG hang ──
  // SĐT không tồn tại → 404; SĐT có + sai pwd → 401. Cả 2 đều là phản
  // hồi sạch < 5s (không treo, không loop). Đây là điều cần verify.
  try {
    const res = await timed(async () => {
      const r = await fetch(`${BASE}/api/auth/sign-in?redirect=%2F`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: "0000000000", password: "definitely_wrong_pwd" }),
        redirect: "manual",
      });
      const data = await r.json().catch(() => null);
      return { status: r.status, data };
    });
    const ok = [400, 401, 404].includes(res.status) && res.ms < 5000;
    check(
      "T2. Login sai → 4xx sạch, không treo (chống loop)",
      ok,
      `status=${res.status}, msg="${res.data?.error}", ${res.ms}ms (chuẩn: 4xx < 5s)`
    );
  } catch (e) {
    check("T2. Login sai → 4xx sạch", false, String(e));
  }

  // ── TEST 3: Login thiếu field → 400 validation ──
  try {
    const res = await timed(async () => {
      const r = await fetch(`${BASE}/api/auth/sign-in?redirect=%2F`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: "", password: "" }),
        redirect: "manual",
      });
      const data = await r.json().catch(() => null);
      return { status: r.status, data };
    });
    const ok = res.status === 400;
    check(
      "T3. Login thiếu field → 400 validation",
      ok,
      `status=${res.status}, msg="${res.data?.error}", ${res.ms}ms`
    );
  } catch (e) {
    check("T3. Login thiếu field → 400", false, String(e));
  }

  // ── TEST 4: Cookie RÁC trên trang protected → redirect /dang-nhap ──
  try {
    const res = await timed(async () => {
      const r = await fetch(`${BASE}/hang-hoa`, {
        headers: { Cookie: `${COOKIE_NAME}=${GARBAGE}` },
        redirect: "manual",
      });
      return { status: r.status, location: r.headers.get("location") };
    });
    const redirectsToLogin = (res.status === 307 || res.status === 302 || res.status === 303) &&
      (res.location || "").includes("/dang-nhap");
    check(
      "T4. Cookie RÁC vào /hang-hoa → redirect /dang-nhap",
      redirectsToLogin,
      `status=${res.status}, location="${res.location}", ${res.ms}ms`
    );
  } catch (e) {
    check("T4. Cookie rác → redirect login", false, String(e));
  }

  // ── TEST 5: Không cookie vào trang protected → redirect /dang-nhap ──
  try {
    const res = await timed(async () => {
      const r = await fetch(`${BASE}/so-quy`, { redirect: "manual" });
      return { status: r.status, location: r.headers.get("location") };
    });
    const ok = (res.status === 307 || res.status === 302) &&
      (res.location || "").includes("/dang-nhap");
    check(
      "T5. Không cookie vào /so-quy → redirect /dang-nhap",
      ok,
      `status=${res.status}, location="${res.location}", ${res.ms}ms`
    );
  } catch (e) {
    check("T5. Không cookie → redirect login", false, String(e));
  }

  // ── TEST 6: Cookie RÁC redirect tới /dang-nhap → trang đó vẫn serve script clear ──
  try {
    const res = await timed(async () => {
      const r = await fetch(`${BASE}/dang-nhap?redirect=%2Fhang-hoa`, {
        headers: { Cookie: `${COOKIE_NAME}=${GARBAGE}` },
        redirect: "manual",
      });
      const body = await r.text();
      return { status: r.status, hasScript: body.includes("isLoginPage") };
    });
    const ok = res.status === 200 && res.hasScript;
    check(
      "T6. /dang-nhap (kèm cookie rác) vẫn serve script clear",
      ok,
      `status=${res.status}, hasClearScript=${res.hasScript}, ${res.ms}ms`
    );
  } catch (e) {
    check("T6. /dang-nhap kèm cookie rác serve script", false, String(e));
  }

  // ── TEST 7: 5 lần login sai liên tiếp — đo có hang/treo không ──
  try {
    const times = [];
    for (let i = 0; i < 5; i++) {
      const res = await timed(async () => {
        const r = await fetch(`${BASE}/api/auth/sign-in?redirect=%2F`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier: "0000000000", password: "wrong" + i }),
          redirect: "manual",
        });
        await r.text();
        return { status: r.status };
      });
      times.push(res.ms);
    }
    const maxTime = Math.max(...times);
    const ok = maxTime < 5000;
    check(
      "T7. 5 login sai liên tiếp — không treo (chống loop)",
      ok,
      `thời gian mỗi lần: [${times.join(", ")}]ms — max ${maxTime}ms (chuẩn < 5s)`
    );
  } catch (e) {
    check("T7. 5 login sai liên tiếp", false, String(e));
  }

  // ── KẾT QUẢ ──
  console.log("\n═══════════════════════════════════════════════════════");
  console.log(` KẾT QUẢ: ${pass} PASS / ${fail} FAIL  (tổng ${pass + fail} test)`);
  console.log("═══════════════════════════════════════════════════════");
  if (fail === 0) {
    console.log(" ✅ TẦNG HTTP/SERVER: luồng auth khoẻ mạnh, không treo.");
  } else {
    console.log(" ⚠️ Có test FAIL — xem chi tiết ở trên.");
  }
  console.log("\nGHI CHÚ: Bộ test này verify TẦNG SERVER (HTTP). Phần");
  console.log("client-side (SDK loop trong browser) đã verify riêng qua");
  console.log("Chrome MCP (inject cookie rác → inline script tự xoá).");

  process.exit(fail === 0 ? 0 : 1);
}

main();
