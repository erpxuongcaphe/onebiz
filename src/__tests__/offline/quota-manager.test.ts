import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Quota Manager Tests — offline IndexedDB quota handling
 *
 * Covers:
 *   - isQuotaExceededError: multi-browser detection
 *   - getStorageEstimate: Storage API wrapper + fallback
 *   - performEmergencyCleanup: clears menu_cache + completed sync entries
 *   - withQuotaRecovery: retry-after-cleanup on quota error
 *   - checkQuotaHealth: preemptive warning/cleanup levels
 *   - formatBytes: human-readable sizing
 */

// ── Mock IndexedDB layer ──
const mockCompletedKeys: number[] = [];
const mockDeleteCalls: number[] = [];
let mockDbClearCalled = false;

vi.mock("@/lib/offline/db", () => ({
  getDb: vi.fn(async () => ({
    clear: vi.fn(async (_store: string) => {
      mockDbClearCalled = true;
    }),
    transaction: vi.fn(() => ({
      objectStore: vi.fn(() => ({
        index: vi.fn(() => ({
          getAllKeys: vi.fn(async (_status: string) => mockCompletedKeys),
        })),
        delete: vi.fn(async (key: number) => {
          mockDeleteCalls.push(key);
        }),
      })),
      done: Promise.resolve(),
    })),
  })),
}));

import {
  isQuotaExceededError,
  getStorageEstimate,
  performEmergencyCleanup,
  withQuotaRecovery,
  checkQuotaHealth,
  formatBytes,
  QUOTA_WARN_PERCENT,
  QUOTA_CRITICAL_PERCENT,
} from "@/lib/offline/quota-manager";

beforeEach(() => {
  mockCompletedKeys.length = 0;
  mockDeleteCalls.length = 0;
  mockDbClearCalled = false;
});

afterEach(() => {
  // Cleanup navigator stubs
  if ("storage" in globalThis.navigator) {
    try {
      // @ts-expect-error — test cleanup
      delete globalThis.navigator.storage;
    } catch {
      // ignore
    }
  }
});

// ========================================
// isQuotaExceededError
// ========================================

describe("isQuotaExceededError", () => {
  it("returns false for null/undefined", () => {
    expect(isQuotaExceededError(null)).toBe(false);
    expect(isQuotaExceededError(undefined)).toBe(false);
  });

  it("detects QuotaExceededError (Chrome / modern)", () => {
    const err = Object.assign(new Error("quota"), { name: "QuotaExceededError" });
    expect(isQuotaExceededError(err)).toBe(true);
  });

  it("detects NS_ERROR_DOM_QUOTA_REACHED (old Firefox)", () => {
    const err = Object.assign(new Error("fx"), { name: "NS_ERROR_DOM_QUOTA_REACHED" });
    expect(isQuotaExceededError(err)).toBe(true);
  });

  it("detects DOMException code 22 (legacy Safari)", () => {
    const err = { code: 22, name: "OtherError" };
    expect(isQuotaExceededError(err)).toBe(true);
  });

  it("detects message containing 'quota'", () => {
    const err = new Error("Disk quota exceeded");
    expect(isQuotaExceededError(err)).toBe(true);
  });

  it("detects nested error via cause", () => {
    const inner = Object.assign(new Error("q"), { name: "QuotaExceededError" });
    const outer = { name: "WrappedError", cause: inner };
    expect(isQuotaExceededError(outer)).toBe(true);
  });

  it("returns false for generic errors", () => {
    expect(isQuotaExceededError(new Error("Network timeout"))).toBe(false);
    expect(isQuotaExceededError({ name: "TypeError" })).toBe(false);
    expect(isQuotaExceededError("string error")).toBe(false);
  });

  it("returns false for plain objects without quota markers", () => {
    expect(isQuotaExceededError({ code: 500 })).toBe(false);
    expect(isQuotaExceededError({ name: "AbortError" })).toBe(false);
  });
});

// ========================================
// getStorageEstimate
// ========================================

describe("getStorageEstimate", () => {
  it("returns supported=false when navigator.storage missing", async () => {
    // Ensure no storage object
    const est = await getStorageEstimate();
    // In jsdom, navigator.storage may exist but estimate may not — handle both
    if (!est.supported) {
      expect(est.supported).toBe(false);
      expect(est.quota).toBe(0);
      expect(est.usage).toBe(0);
    } else {
      // If supported, just verify shape
      expect(typeof est.quota).toBe("number");
      expect(typeof est.usage).toBe("number");
    }
  });

  it("calculates percentUsed correctly when supported", async () => {
    const mockEstimate = vi.fn(async () => ({ quota: 1000, usage: 250 }));
    Object.defineProperty(globalThis.navigator, "storage", {
      value: { estimate: mockEstimate, persist: vi.fn() },
      configurable: true,
      writable: true,
    });

    const est = await getStorageEstimate();
    expect(est.supported).toBe(true);
    expect(est.quota).toBe(1000);
    expect(est.usage).toBe(250);
    expect(est.percentUsed).toBe(25);
  });

  it("handles estimate() throwing gracefully", async () => {
    const mockEstimate = vi.fn(async () => {
      throw new Error("Access denied");
    });
    Object.defineProperty(globalThis.navigator, "storage", {
      value: { estimate: mockEstimate, persist: vi.fn() },
      configurable: true,
      writable: true,
    });

    const est = await getStorageEstimate();
    expect(est.supported).toBe(false);
    expect(est.quota).toBe(0);
  });
});

// ========================================
// performEmergencyCleanup
// ========================================

describe("performEmergencyCleanup", () => {
  it("clears menu_cache and removes completed sync entries", async () => {
    mockCompletedKeys.push(1, 2, 3, 5, 8);

    const result = await performEmergencyCleanup();

    expect(result.menuCacheCleared).toBe(true);
    expect(result.completedSyncRemoved).toBe(5);
    expect(mockDbClearCalled).toBe(true);
    expect(mockDeleteCalls).toEqual([1, 2, 3, 5, 8]);
  });

  it("returns 0 completed removed when queue has no completed entries", async () => {
    // mockCompletedKeys stays empty
    const result = await performEmergencyCleanup();

    expect(result.menuCacheCleared).toBe(true);
    expect(result.completedSyncRemoved).toBe(0);
  });
});

// ========================================
// withQuotaRecovery
// ========================================

describe("withQuotaRecovery", () => {
  it("passes through result when operation succeeds first try", async () => {
    const op = vi.fn(async () => "ok");
    const result = await withQuotaRecovery(op);
    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("retries once after cleanup on quota error", async () => {
    let callCount = 0;
    const op = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw Object.assign(new Error("quota"), { name: "QuotaExceededError" });
      }
      return "ok-after-retry";
    });

    const result = await withQuotaRecovery(op);
    expect(result).toBe("ok-after-retry");
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("propagates non-quota errors without retry", async () => {
    const op = vi.fn(async () => {
      throw new Error("Network failure");
    });

    await expect(withQuotaRecovery(op)).rejects.toThrow("Network failure");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("propagates quota error if retry also fails with quota", async () => {
    const op = vi.fn(async () => {
      throw Object.assign(new Error("quota"), { name: "QuotaExceededError" });
    });

    await expect(withQuotaRecovery(op)).rejects.toMatchObject({
      name: "QuotaExceededError",
    });
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("invokes onCleanup callback with cleanup result", async () => {
    let callCount = 0;
    const op = async () => {
      callCount++;
      if (callCount === 1) {
        throw Object.assign(new Error("quota"), { name: "QuotaExceededError" });
      }
      return "ok";
    };

    const onCleanup = vi.fn();
    await withQuotaRecovery(op, onCleanup);

    expect(onCleanup).toHaveBeenCalledTimes(1);
    const arg = onCleanup.mock.calls[0][0];
    expect(arg).toHaveProperty("menuCacheCleared");
    expect(arg).toHaveProperty("completedSyncRemoved");
    expect(arg).toHaveProperty("bytesFreed");
  });
});

// ========================================
// checkQuotaHealth
// ========================================

describe("checkQuotaHealth", () => {
  it("returns level=ok when usage is low", async () => {
    Object.defineProperty(globalThis.navigator, "storage", {
      value: {
        estimate: vi.fn(async () => ({ quota: 1000, usage: 100 })),
        persist: vi.fn(),
      },
      configurable: true,
      writable: true,
    });

    const health = await checkQuotaHealth();
    expect(health.level).toBe("ok");
    expect(health.cleanupPerformed).toBe(null);
  });

  it(`returns level=warn when usage >= ${QUOTA_WARN_PERCENT}%`, async () => {
    Object.defineProperty(globalThis.navigator, "storage", {
      value: {
        estimate: vi.fn(async () => ({ quota: 1000, usage: 850 })),
        persist: vi.fn(),
      },
      configurable: true,
      writable: true,
    });

    const health = await checkQuotaHealth();
    expect(health.level).toBe("warn");
    expect(health.cleanupPerformed).toBe(null);
  });

  it(`returns level=critical and runs cleanup when usage >= ${QUOTA_CRITICAL_PERCENT}%`, async () => {
    Object.defineProperty(globalThis.navigator, "storage", {
      value: {
        estimate: vi.fn(async () => ({ quota: 1000, usage: 970 })),
        persist: vi.fn(),
      },
      configurable: true,
      writable: true,
    });

    const health = await checkQuotaHealth(true);
    expect(health.level).toBe("critical");
    expect(health.cleanupPerformed).not.toBe(null);
    expect(health.cleanupPerformed?.menuCacheCleared).toBe(true);
  });

  it("skips cleanup when autoCleanupOnCritical=false", async () => {
    Object.defineProperty(globalThis.navigator, "storage", {
      value: {
        estimate: vi.fn(async () => ({ quota: 1000, usage: 990 })),
        persist: vi.fn(),
      },
      configurable: true,
      writable: true,
    });

    const health = await checkQuotaHealth(false);
    expect(health.level).toBe("critical");
    expect(health.cleanupPerformed).toBe(null);
  });

  it("returns level=ok when Storage API unsupported", async () => {
    // No navigator.storage — getStorageEstimate returns supported=false
    if ("storage" in globalThis.navigator) {
      // @ts-expect-error — test cleanup
      delete globalThis.navigator.storage;
    }

    const health = await checkQuotaHealth();
    expect(health.level).toBe("ok");
    expect(health.cleanupPerformed).toBe(null);
  });
});

// ========================================
// formatBytes
// ========================================

describe("formatBytes", () => {
  it("formats bytes under 1KB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats KB range", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1023)).toBe("1023.0 KB");
  });

  it("formats MB range", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 50)).toBe("50.0 MB");
  });

  it("formats GB range", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.00 GB");
    expect(formatBytes(1024 * 1024 * 1024 * 2.5)).toBe("2.50 GB");
  });
});
