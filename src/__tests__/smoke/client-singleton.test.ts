/**
 * Smoke test: createClient() phải return cùng 1 instance (singleton).
 *
 * Bug history: createClient() trong client.ts comment "Singleton" nhưng
 * implementation tạo NEW instance mỗi call → N+ GoTrue lock instances
 * → race condition → UI treo khi save tier.
 *
 * Test này catch regression nếu ai đó "tối ưu" bằng cách bỏ cache.
 */

import { describe, it, expect } from "vitest";
import { createClient } from "@/lib/supabase/client";

describe("Supabase client singleton", () => {
  it("createClient() phải trả cùng 1 instance qua nhiều lần gọi", () => {
    const a = createClient();
    const b = createClient();
    const c = createClient();

    // Reference equality — KHÔNG được tạo new instance.
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).toBe(c);
  });

  it("client phải có method auth (Supabase client interface)", () => {
    const client = createClient();
    expect(client.auth).toBeDefined();
    expect(typeof client.from).toBe("function");
  });
});
