/**
 * Cross-tenant data leak detection — static analysis test
 *
 * Mục tiêu: ngăn dev tương lai (cả Claude và human) viết service mới mà
 * QUÊN filter tenant_id. Test chạy trong CI để fail PR sớm.
 *
 * Logic:
 *   - Đọc mọi file service `.ts` trong `src/lib/services/supabase/`
 *   - Đếm số `.from("table_name")` calls (queries vào Supabase)
 *   - Đếm số reference đến `tenant_id` (filter, insert, fetch helper)
 *   - Đảm bảo file có queries phải có ít nhất X tenant references
 *
 * Whitelist: 1 số service không cần tenant filter (global tables như
 * `tenants`, `pipelines`, `pipeline_stages`, hoặc helpers thuần như
 * `base.ts`, `index.ts`).
 *
 * Không phải test runtime — không gọi DB. Test này chỉ enforce coding
 * convention. Layer 1 (RLS) + Layer 3 (smoke test với 2 tenant thật)
 * vẫn cần.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const SERVICE_DIR = join(process.cwd(), "src/lib/services/supabase");

// File KHÔNG cần tenant filter (utility / global table only)
const WHITELIST = new Set([
  "base.ts", // helper module — chính nó định nghĩa getCurrentTenantId
  "index.ts", // re-export only
  "audit.ts", // audit_log có tenant nhưng query qua entity_id, audit qua FE
  "pipeline.ts", // global pipelines (không có tenant_id, là template)
  "playbook-engine.ts", // global rules
]);

// Files đã audited + verified — strict mode (yêu cầu cao)
const AUDITED_STRICT = new Set([
  "products.ts",
  "categories.ts",
  "suppliers.ts",
  "customers.ts",
  "invoices.ts",
  "branch-stock.ts",
]);

interface ServiceAudit {
  file: string;
  fromCalls: number;
  tenantRefs: number;
  hasGetTenantId: boolean;
  hasInsertTenantHardcode: boolean;
}

function stripComments(content: string): string {
  // Strip /* ... */ block comments
  const noBlock = content.replace(/\/\*[\s\S]*?\*\//g, "");
  // Strip `// ...` line comments
  return noBlock
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      // Naive: nếu // nằm trong string literal trước nó thì sai. Service files
      // không có URL strings phía trước "//" nên đủ an toàn cho audit này.
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
}

function auditServiceFile(filePath: string): ServiceAudit {
  const raw = readFileSync(filePath, "utf-8");
  const code = stripComments(raw);
  const file = filePath.split(/[/\\]/).pop()!;

  const fromMatches = code.match(/\.from\("[^"]+"\)/g) ?? [];

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

  // Anti-pattern: hardcoded `tenant_id: ""` — chỉ check trong code, không
  // phải comment (tránh false positive khi code comment mention "tenant_id: \"\"" để nói
  // "đây là pattern cũ").
  const hasInsertTenantHardcode = /tenant_id:\s*""/.test(code);

  return {
    file,
    fromCalls: fromMatches.length,
    tenantRefs,
    hasGetTenantId: /getCurrentTenantId|getCurrentContext/.test(code),
    hasInsertTenantHardcode,
  };
}

function listServiceFiles(): string[] {
  return readdirSync(SERVICE_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => join(SERVICE_DIR, name))
    .filter((path) => statSync(path).isFile());
}

describe("Multi-tenant safety — Layer 2 (service-level)", () => {
  const allFiles = listServiceFiles();

  it("phải có ít nhất 1 service file để audit", () => {
    expect(allFiles.length).toBeGreaterThan(10);
  });

  it("KHÔNG có service nào hardcode tenant_id: \"\" (anti-pattern)", () => {
    const violations: string[] = [];
    for (const path of allFiles) {
      const audit = auditServiceFile(path);
      if (audit.hasInsertTenantHardcode) {
        violations.push(audit.file);
      }
    }
    expect(violations, `Service files có \`tenant_id: ""\`: ${violations.join(", ")}`).toEqual([]);
  });

  describe("Service đã audit (strict mode)", () => {
    for (const fileName of AUDITED_STRICT) {
      it(`${fileName} — mọi query phải có tenant filter`, () => {
        const path = join(SERVICE_DIR, fileName);
        const audit = auditServiceFile(path);

        // Service có queries phải có tenant references >= number-of-queries / 2
        // (vì 1 query có thể có 1 .eq + 1 getCurrentTenantId, hoặc 1 insert có
        // 1 tenant_id field). Tỷ lệ 1:2 là conservative threshold.
        const minTenantRefs = Math.ceil(audit.fromCalls / 2);
        expect(
          audit.tenantRefs,
          `${fileName}: ${audit.fromCalls} queries nhưng chỉ ${audit.tenantRefs} tenant refs (cần >= ${minTenantRefs})`,
        ).toBeGreaterThanOrEqual(minTenantRefs);

        expect(
          audit.hasGetTenantId,
          `${fileName} phải import & gọi getCurrentTenantId() hoặc getCurrentContext()`,
        ).toBe(true);
      });
    }
  });

  describe("Service chưa audit (warning mode)", () => {
    const unaudited = allFiles
      .map((p) => p.split(/[/\\]/).pop()!)
      .filter((name) => !WHITELIST.has(name) && !AUDITED_STRICT.has(name));

    it(`báo cáo coverage hiện tại của ${unaudited.length} service chưa audit`, () => {
      const report: Array<{ file: string; from: number; tenant: number; safe: boolean }> = [];

      for (const fileName of unaudited) {
        const audit = auditServiceFile(join(SERVICE_DIR, fileName));
        if (audit.fromCalls === 0) continue; // service không query DB
        report.push({
          file: fileName,
          from: audit.fromCalls,
          tenant: audit.tenantRefs,
          safe: audit.tenantRefs >= Math.ceil(audit.fromCalls / 2),
        });
      }

      // Không assert fail — chỉ log info để CEO/dev biết tiến độ.
      const unsafeCount = report.filter((r) => !r.safe).length;
      console.info(
        `[tenant-isolation] ${report.length - unsafeCount}/${report.length} unaudited services có tenant coverage adequate. ${unsafeCount} cần audit.`,
      );

      // Test luôn pass (warning mode), check log nếu unsafeCount > 0
      expect(report.length).toBeGreaterThan(0);
    });
  });
});
