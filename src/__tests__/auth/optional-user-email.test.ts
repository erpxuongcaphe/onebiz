import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isInternalAuthEmail,
  isValidVnPhone,
  normalizeVnPhone,
} from "@/lib/auth/user-identifiers";

const migration = readFileSync(
  resolve("supabase/migrations/00191_optional_profile_email.sql"),
  "utf8",
);

describe("optional OneBiz user email", () => {
  it("normalizes accepted Vietnamese phone formats", () => {
    expect(normalizeVnPhone("+84 912-345-678")).toBe("0912345678");
    expect(normalizeVnPhone("0912 345 678")).toBe("0912345678");
    expect(isValidVnPhone("0912345678")).toBe(true);
    expect(isValidVnPhone("123")).toBe(false);
  });

  it("recognizes non-deliverable internal Auth emails", () => {
    expect(isInternalAuthEmail("staff-id@auth.onebiz.invalid")).toBe(true);
    expect(isInternalAuthEmail("staff@onebiz.com.vn")).toBe(false);
  });

  it("makes profile contact email nullable and resolves login from auth.users", () => {
    expect(migration).toContain("alter column email drop not null");
    expect(migration).toContain("join auth.users au on au.id = p.id");
    expect(migration).toContain("select au.email");
    expect(migration).toContain(
      "grant execute on function public.get_email_by_phone(text) to anon, authenticated",
    );
  });
});
