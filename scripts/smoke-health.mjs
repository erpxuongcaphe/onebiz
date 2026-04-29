#!/usr/bin/env node
/**
 * smoke-health.mjs — kiểm tra production URL alive + critical pages return 200.
 *
 * Usage:
 *   node scripts/smoke-health.mjs                   # default https://onebiz.com.vn
 *   node scripts/smoke-health.mjs --url=preview.vercel.app
 *
 * Output:
 *   ✅ /                   200  (124ms)
 *   ✅ /dang-nhap          200  (87ms)
 *   ⚠️ /hang-hoa           302  redirected to /dang-nhap (auth required, OK)
 *   ❌ /api/_health        500  Internal Server Error
 *
 * Exit code:
 *   0 — all pages OK (200 hoặc 30x auth redirect)
 *   1 — có page return 4xx/5xx
 *
 * Plus: tự log timestamp để CEO thấy trong CI/CD pipeline.
 */

const args = process.argv.slice(2);
const urlArg = args.find((a) => a.startsWith("--url="));
const baseUrl = urlArg
  ? `https://${urlArg.slice(6).replace(/^https?:\/\//, "")}`
  : "https://onebiz.com.vn";

// Critical public pages — không cần auth, phải luôn 200.
// Pages auth-required → redirect 302 (counted as OK vì server alive).
const PAGES = [
  { path: "/", expectAuth: false },
  { path: "/dang-nhap", expectAuth: false },
  { path: "/hang-hoa", expectAuth: true }, // auth → redirect /dang-nhap
  { path: "/hang-hoa/thiet-lap-gia", expectAuth: true },
  { path: "/cai-dat/chi-nhanh", expectAuth: true },
];

const TIMEOUT_MS = 10000;

async function check(path, expectAuth) {
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(`${baseUrl}${path}`, {
      redirect: "manual",
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const ms = Date.now() - start;
    const status = res.status;
    let label;
    let ok;

    if (status === 200) {
      label = "✅";
      ok = true;
    } else if ([301, 302, 307, 308].includes(status)) {
      const loc = res.headers.get("location") ?? "";
      const isAuthRedirect = /dang-nhap|login|auth/i.test(loc);
      if (expectAuth && isAuthRedirect) {
        label = "✅";
        ok = true;
      } else {
        label = "⚠️";
        ok = true;
      }
    } else {
      label = "❌";
      ok = false;
    }

    console.log(
      `  ${label} ${path.padEnd(35)} ${status}  (${ms}ms)`,
    );
    return { path, status, ms, ok };
  } catch (err) {
    const ms = Date.now() - start;
    console.log(
      `  ❌ ${path.padEnd(35)} ERROR (${ms}ms)  ${err.message ?? err}`,
    );
    return { path, status: 0, ms, ok: false };
  }
}

async function main() {
  console.log(`\n🩺 Smoke health check — ${new Date().toISOString()}`);
  console.log(`   URL: ${baseUrl}\n`);

  const results = [];
  for (const p of PAGES) {
    results.push(await check(p.path, p.expectAuth));
  }

  const failed = results.filter((r) => !r.ok);
  const totalMs = results.reduce((s, r) => s + r.ms, 0);
  console.log(
    `\n   ${results.length - failed.length}/${results.length} pages OK · ${totalMs}ms total`,
  );

  if (failed.length > 0) {
    console.log(`\n❌ ${failed.length} pages failed:`);
    failed.forEach((f) =>
      console.log(`     - ${f.path} (status ${f.status})`),
    );
    process.exit(1);
  }
  console.log(`\n✅ All pages alive\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Smoke check fatal:", err);
  process.exit(1);
});
