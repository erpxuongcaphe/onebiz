import { afterEach, describe, expect, it, vi } from "vitest";
import { createPosSessionId } from "@/lib/pos-session-id";

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("POS session IDs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the browser UUID generator when available", () => {
    const id = "14cbf398-6337-47a0-9ee1-16cd4fe19e57";
    vi.stubGlobal("crypto", { randomUUID: () => id });
    expect(createPosSessionId()).toBe(id);
  });

  it("generates valid distinct UUIDs when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
      return bytes;
    } });
    const ids = new Set(Array.from({ length: 100 }, createPosSessionId));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(uuidV4);
  });

  it("still generates a UUID when the crypto API is absent", () => {
    vi.stubGlobal("crypto", undefined);
    expect(createPosSessionId()).toMatch(uuidV4);
  });
});
