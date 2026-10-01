import { afterEach, expect, it, vi } from "vitest";

const createBrowserClientMock = vi.hoisted(() =>
  vi.fn((url: string, key: string, options?: unknown) => ({
    auth: {},
    url,
    key,
    options,
  })),
);

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: createBrowserClientMock,
}));

const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
  createBrowserClientMock.mockClear();
  vi.resetModules();
});

it("removes a trailing newline before the browser client builds Realtime URLs", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key\n";

  const { createClient } = await import("@/lib/supabase/client");
  createClient();

  expect(createBrowserClientMock).toHaveBeenCalledOnce();
  expect(createBrowserClientMock.mock.calls[0][1]).toBe("test-anon-key");
});
