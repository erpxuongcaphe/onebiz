#!/usr/bin/env node
/**
 * smoke-all.mjs — aggregator chạy TẤT CẢ smoke checks tuần tự.
 *
 * Use case:
 *   - Mỗi sprint Claude tự chạy `npm run smoke` để verify zero regression.
 *   - CEO chạy trước commit để chắc chắn không miss critical bug.
 *   - CI/CD pre-deploy gate.
 *
 * Steps (fail-fast, dừng ngay nếu step lỗi):
 *   1. tsc --noEmit       → type check
 *   2. test:smoke         → vitest smoke subset (unit + integration mock)
 *   3. check:tenant       → static analysis tenant isolation
 *   4. smoke:health       → ping production URL
 *
 * Exit 0 nếu all pass, 1 nếu bất kỳ step fail.
 */

import { spawnSync } from "node:child_process";

const STEPS = [
  {
    label: "TypeScript",
    cmd: "npx",
    args: ["tsc", "--noEmit"],
  },
  {
    label: "Smoke tests",
    cmd: "npx",
    args: ["vitest", "run", "src/__tests__/smoke/"],
  },
  {
    label: "Tenant isolation",
    cmd: "node",
    args: ["scripts/check-tenant-isolation.mjs"],
  },
  {
    label: "Health (production URL)",
    cmd: "node",
    args: ["scripts/smoke-health.mjs"],
    optional: true, // network có thể fail, không block
  },
];

let failed = 0;
let optionalFailed = 0;
const startAll = Date.now();

for (const step of STEPS) {
  const start = Date.now();
  console.log(`\n━━━━━ ${step.label} ━━━━━`);
  const result = spawnSync(step.cmd, step.args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const ms = Date.now() - start;
  if (result.status === 0) {
    console.log(`\n✅ ${step.label} (${ms}ms)`);
  } else if (step.optional) {
    console.log(`\n⚠️  ${step.label} failed but optional (${ms}ms)`);
    optionalFailed++;
  } else {
    console.log(`\n❌ ${step.label} FAILED (${ms}ms)`);
    failed++;
    break; // fail-fast cho non-optional
  }
}

const totalMs = Date.now() - startAll;
console.log(`\n${"━".repeat(60)}`);
console.log(`Total: ${totalMs}ms`);
if (failed === 0) {
  console.log(
    `✅ All smoke checks passed${optionalFailed > 0 ? ` (${optionalFailed} optional warning)` : ""}\n`,
  );
  process.exit(0);
}
console.log(`❌ ${failed} step(s) failed — fix before deploy\n`);
process.exit(1);
