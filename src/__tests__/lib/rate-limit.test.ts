/**
 * Test rate-limit helper (CEO 13/05).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    // Reset memory store giữa các test bằng key unique
    vi.useRealTimers();
  });

  it("cho phép request thứ 1 trong window", () => {
    const result = checkRateLimit("test:1:first", {
      limit: 5,
      windowMs: 60_000,
    });
    expect(result.allowed).toBe(true);
    expect(result.used).toBe(1);
    expect(result.remaining).toBe(4);
    expect(result.resetAt).toBeGreaterThan(Date.now());
  });

  it("tăng counter khi gọi lại cùng key", () => {
    checkRateLimit("test:2:incr", { limit: 5, windowMs: 60_000 });
    checkRateLimit("test:2:incr", { limit: 5, windowMs: 60_000 });
    const result = checkRateLimit("test:2:incr", { limit: 5, windowMs: 60_000 });
    expect(result.used).toBe(3);
    expect(result.remaining).toBe(2);
  });

  it("block khi hit limit", () => {
    const opts = { limit: 3, windowMs: 60_000 };
    expect(checkRateLimit("test:3:block", opts).allowed).toBe(true); // 1
    expect(checkRateLimit("test:3:block", opts).allowed).toBe(true); // 2
    expect(checkRateLimit("test:3:block", opts).allowed).toBe(true); // 3
    const blocked = checkRateLimit("test:3:block", opts); // 4
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("cô lập giữa các key", () => {
    const opts = { limit: 2, windowMs: 60_000 };
    expect(checkRateLimit("test:4:userA", opts).allowed).toBe(true);
    expect(checkRateLimit("test:4:userA", opts).allowed).toBe(true);
    expect(checkRateLimit("test:4:userA", opts).allowed).toBe(false);
    // key khác không bị ảnh hưởng
    expect(checkRateLimit("test:4:userB", opts).allowed).toBe(true);
    expect(checkRateLimit("test:4:userB", opts).allowed).toBe(true);
  });

  it("reset counter khi window expire", () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const opts = { limit: 2, windowMs: 1000 };
    expect(checkRateLimit("test:5:expire", opts).allowed).toBe(true);
    expect(checkRateLimit("test:5:expire", opts).allowed).toBe(true);
    expect(checkRateLimit("test:5:expire", opts).allowed).toBe(false);

    // Advance time 1.5s → window expired
    vi.setSystemTime(now + 1500);
    const result = checkRateLimit("test:5:expire", opts);
    expect(result.allowed).toBe(true);
    expect(result.used).toBe(1); // counter reset

    vi.useRealTimers();
  });
});

describe("getClientIp", () => {
  it("trả về IP từ x-forwarded-for", () => {
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4" });
    expect(getClientIp({ headers })).toBe("1.2.3.4");
  });

  it("trả về IP đầu tiên khi x-forwarded-for có chain proxy", () => {
    const headers = new Headers({
      "x-forwarded-for": "1.2.3.4, 10.0.0.1, 192.168.1.1",
    });
    expect(getClientIp({ headers })).toBe("1.2.3.4");
  });

  it("trim whitespace khi parse x-forwarded-for chain", () => {
    const headers = new Headers({
      "x-forwarded-for": "  1.2.3.4  ,  10.0.0.1  ",
    });
    expect(getClientIp({ headers })).toBe("1.2.3.4");
  });

  it("fallback x-real-ip nếu không có x-forwarded-for", () => {
    const headers = new Headers({ "x-real-ip": "5.6.7.8" });
    expect(getClientIp({ headers })).toBe("5.6.7.8");
  });

  it("trả 'unknown' nếu không có header IP nào", () => {
    expect(getClientIp({ headers: new Headers() })).toBe("unknown");
  });
});
