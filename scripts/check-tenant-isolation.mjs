#!/usr/bin/env node
/**
 * check-tenant-isolation.mjs — static analysis verify tất cả services
 * filter tenant_id đúng pattern.
 *
 * Khác với src/__tests__/security/tenant-isolation.test.ts (chạy qua
 * vitest), script này chạy nhanh standalone trong CI / pre-commit hook.
 *
 * Usage:
 *   node scripts/check-tenant-isolation.mjs
 *
 * Exit code:
 *   0 — clean
 *   1 — phát hiện service có pattern leak (hardcode "" hoặc thiếu filter)
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVICE_DIR = join(__dirname, "../src/lib/services/supabase");

const WHITELIST = new Set(["base.ts", "index.ts", "audit.ts", "playbook-engine.ts"]);

function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
}

function audit(filePath) {
  const raw = readFileSync(filePath, "utf-8");
  const code = stripComments(raw);
  const file = filePath.split(/[/\\]/).pop();

  const fromCalls = (code.match(/\.from\("[^"]+"\)/g) ?? []).length;
  const tenantPatterns = [
    /eq\("tenant_id"/g,
    /tenant_id:\s*tenantId/g,
    /tenant_id:\s*ctx\.tenantId/g,
    /getCurrentTenantId\(\)/g,
    /getCurrentContext\(\)/g,
  ];
  let tenantRefs = 0;
  for (const pat of tenantPatterns) {
    tenantRefs += (code.match(pat) ?? []).length;
  }

  const hasHardcode = /tenant_id:\s*""/.test(code);
  return { file, fromCalls, tenantRefs, hasHardcode };
}

function main() {
  console.log(`\n🔒 Tenant isolation static check\n`);
  const files = readdirSync(SERVICE_DIR)
    .filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts") && !WHITELIST.has(n))
    .map((n) => join(SERVICE_DIR, n))
    .filter((p) => statSync(p).isFile());

  const violations = [];
  const warnings = [];
  let clean = 0;

  for (const path of files) {
    const a = audit(path);
    if (a.hasHardcode) {
      violations.push(`  ❌ ${a.file.padEnd(30)} hardcode \`tenant_id: ""\``);
    } else if (a.fromCalls > 0 && a.tenantRefs === 0) {
      violations.push(
        `  ❌ ${a.file.padEnd(30)} ${a.fromCalls} queries, 0 tenant refs`,
      );
    } else if (a.fromCalls > 0 && a.tenantRefs < Math.ceil(a.fromCalls / 2)) {
      warnings.push(
        `  ⚠️ ${a.file.padEnd(30)} ${a.fromCalls} queries, ${a.tenantRefs} tenant refs (cần >= ${Math.ceil(a.fromCalls / 2)})`,
      );
    } else {
      clean++;
    }
  }

  console.log(`Total services: ${files.length}`);
  console.log(`  ✅ Clean: ${clean}`);
  console.log(`  ⚠️  Warning (partial): ${warnings.length}`);
  console.log(`  ❌ Violation: ${violations.length}\n`);

  if (warnings.length > 0) {
    console.log("Warnings:");
    warnings.forEach((w) => console.log(w));
    console.log("");
  }
  if (violations.length > 0) {
    console.log("Violations (must fix):");
    violations.forEach((v) => console.log(v));
    console.log("");
    process.exit(1);
  }

  console.log(`✅ No tenant isolation violations\n`);
  process.exit(0);
}

main();
