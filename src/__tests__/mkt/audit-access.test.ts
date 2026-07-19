import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createMktAuditAccessToken,
  hashMktAuditAccessToken,
  isValidMktAuditAccessToken,
  readMktAuditBearerToken,
  readMktAuditRequestToken,
} from "@/lib/mkt/audit-access";

const migration = readFileSync(
  resolve("supabase/migrations/00211_mkt_audit_ai_access.sql"),
  "utf8",
);
const publicRoute = readFileSync(
  resolve("src/app/api/mkt/v1/audit-runner/ai/route.ts"),
  "utf8",
);
const publicPage = readFileSync(
  resolve("src/app/mkt-ai-audit/[token]/page.tsx"),
  "utf8",
);

describe("MKT Audit Runner external access", () => {
  it("creates high-entropy URL-safe tokens and stores only their hash", () => {
    const token = createMktAuditAccessToken();

    expect(token).toHaveLength(43);
    expect(isValidMktAuditAccessToken(token)).toBe(true);
    expect(hashMktAuditAccessToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashMktAuditAccessToken(token)).toBe(hashMktAuditAccessToken(token));
    expect(migration).toContain("token_hash text not null unique");
    expect(migration).not.toContain("raw_token");
  });

  it("rejects malformed tokens before database access", () => {
    expect(isValidMktAuditAccessToken("a".repeat(42))).toBe(false);
    expect(isValidMktAuditAccessToken("a".repeat(44))).toBe(false);
    expect(isValidMktAuditAccessToken("a".repeat(42) + "!")).toBe(false);
    expect(readMktAuditBearerToken(new Request("https://example.test"))).toBeNull();
  });

  it("accepts bearer, JSON and native form submissions", async () => {
    const token = "A".repeat(43);
    expect(
      readMktAuditBearerToken(
        new Request("https://example.test", {
          headers: { authorization: `Bearer ${token}` },
        }),
      ),
    ).toBe(token);

    expect(
      await readMktAuditRequestToken(
        new Request("https://example.test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        }),
      ),
    ).toBe(token);

    expect(
      await readMktAuditRequestToken(
        new Request("https://example.test", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }),
        }),
      ),
    ).toBe(token);
  });

  it("enforces expiry, revocation, run limits and sandbox isolation in SQL", () => {
    for (const guard of [
      "a.revoked_at is null",
      "a.expires_at > now()",
      "a.used_runs < a.max_runs",
      "is_audit_sandbox",
      "s.sandbox_tenant_id <> s.owner_tenant_id",
      "AUDIT_ALREADY_RUNNING",
      "idx_mkt_audit_one_running_per_sandbox",
    ]) {
      expect(migration).toContain(guard);
    }

    expect(migration).toContain("insert into public.mkt_audit_runs");
    expect(migration).toContain("'running', 10");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
  });

  it("runs all fixed scenarios and exposes no arbitrary scenario input", () => {
    expect(publicRoute).toContain("resolveMktAuditScenarioKeys()");
    expect(publicRoute).not.toContain("scenarioKeys?:");
    expect(publicRoute).toContain("mkt_claim_audit_access_token");
    expect(publicRoute).toContain("mkt_read_audit_access_token");
  });

  it("marks the public page dynamic, private and token-validated", () => {
    expect(publicPage).toContain('dynamic = "force-dynamic"');
    expect(publicPage).toContain("isValidMktAuditAccessToken");
    expect(publicPage).toContain("index: false");
    expect(publicPage).toContain('referrer: "no-referrer"');
  });
});