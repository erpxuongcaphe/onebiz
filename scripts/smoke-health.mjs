#!/usr/bin/env node
/**
 * Production smoke health check.
 *
 * Defaults:
 *   - Main ERP: https://onebiz.com.vn
 *   - FnB POS:  https://fnb.onebiz.com.vn
 *
 * Usage:
 *   node scripts/smoke-health.mjs
 *   node scripts/smoke-health.mjs --url=https://preview.vercel.app
 *   node scripts/smoke-health.mjs --fnb-url=https://fnb.onebiz.com.vn
 *   node scripts/smoke-health.mjs --skip-fnb
 *
 * Exit code:
 *   0 - all critical pages return 200 or an expected auth redirect
 *   1 - any page returns 4xx/5xx or an unexpected redirect
 */

const args = process.argv.slice(2);

function readArg(name, fallback) {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return normalizeUrl(hit.slice(name.length + 3));
}

function normalizeUrl(value) {
  const trimmed = String(value ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

const mainBaseUrl = readArg("url", "https://onebiz.com.vn");
const fnbBaseUrl = readArg("fnb-url", "https://fnb.onebiz.com.vn");
const skipFnb = args.includes("--skip-fnb");

const CHECK_GROUPS = [
  {
    label: "Main ERP",
    baseUrl: mainBaseUrl,
    pages: [
      { path: "/", auth: true },
      { path: "/dang-nhap", auth: false },
      { path: "/hang-hoa", auth: true },
      { path: "/hang-hoa/ton-kho", auth: true },
      { path: "/pos", auth: true },
    ],
  },
  ...(
    skipFnb
      ? []
      : [
          {
            label: "FnB subdomain",
            baseUrl: fnbBaseUrl,
            pages: [
              { path: "/", auth: true },
              { path: "/dang-nhap", auth: false },
              { path: "/kds", auth: true },
              { path: "/pos/fnb", auth: true },
            ],
          },
        ]
  ),
];

const TIMEOUT_MS = 10000;

function isAuthRedirect(location) {
  return /dang-nhap|login|auth/i.test(location ?? "");
}

async function checkPage(group, page) {
  const start = Date.now();
  const url = `${group.baseUrl}${page.path}`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(url, { redirect: "manual", signal: ctrl.signal });
    clearTimeout(timer);

    const elapsed = Date.now() - start;
    const location = res.headers.get("location") ?? "";
    const status = res.status;
    const redirectOk =
      [301, 302, 303, 307, 308].includes(status) &&
      (page.auth ? isAuthRedirect(location) : true);
    const ok = status === 200 || redirectOk;
    const icon = ok ? "OK" : "FAIL";
    const extra = location ? ` -> ${location}` : "";

    console.log(
      `  ${icon.padEnd(4)} ${page.path.padEnd(18)} ${String(status).padEnd(3)} ${String(elapsed).padStart(5)}ms${extra}`,
    );

    return { ok, status, path: page.path, group: group.label };
  } catch (error) {
    const elapsed = Date.now() - start;
    console.log(
      `  FAIL ${page.path.padEnd(18)} ERR ${String(elapsed).padStart(5)}ms ${error?.message ?? error}`,
    );
    return { ok: false, status: 0, path: page.path, group: group.label };
  }
}

async function main() {
  console.log(`\nSmoke health check - ${new Date().toISOString()}`);

  const results = [];
  for (const group of CHECK_GROUPS) {
    console.log(`\n${group.label}: ${group.baseUrl}`);
    for (const page of group.pages) {
      results.push(await checkPage(group, page));
    }
  }

  const failed = results.filter((result) => !result.ok);
  const passed = results.length - failed.length;
  console.log(`\n${passed}/${results.length} checks passed`);

  if (failed.length > 0) {
    console.log("\nFailed checks:");
    failed.forEach((result) => {
      console.log(`  - ${result.group} ${result.path} (status ${result.status})`);
    });
    process.exit(1);
  }

  console.log("All production smoke checks passed\n");
}

main().catch((error) => {
  console.error("Smoke check fatal:", error);
  process.exit(1);
});
