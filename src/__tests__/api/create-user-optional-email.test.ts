import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  profileUpsert: vi.fn(),
  profileUpdateEq: vi.fn(),
  branchInsert: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "owner-1" } }, error: null })),
    },
    from: vi.fn((table: string) => {
      if (table !== "profiles") throw new Error(`Unexpected caller table: ${table}`);
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: { role: "owner", role_id: null, tenant_id: "tenant-1" },
              error: null,
            })),
          })),
        })),
      };
    }),
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: vi.fn(() => ({
    auth: {
      admin: {
        createUser: state.createUser,
        deleteUser: state.deleteUser,
      },
    },
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        return {
          upsert: state.profileUpsert,
          update: vi.fn(() => ({ eq: state.profileUpdateEq })),
        };
      }
      if (table === "user_branches") return { insert: state.branchInsert };
      throw new Error(`Unexpected admin table: ${table}`);
    }),
  })),
}));

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("https://onebiz.com.vn/api/admin/create-user", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      password: "password-123",
      fullName: "Nguyen Van A",
      branchIds: ["branch-1"],
      ...body,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.createUser.mockResolvedValue({ data: { user: { id: "new-user-1" } }, error: null });
  state.deleteUser.mockResolvedValue({ data: {}, error: null });
  state.profileUpsert.mockResolvedValue({ data: {}, error: null });
  state.profileUpdateEq.mockResolvedValue({ data: {}, error: null });
  state.branchInsert.mockResolvedValue({ data: {}, error: null });
});

describe("POST /api/admin/create-user with optional contact email", () => {
  it("creates a phone-only account with a private internal Auth email", async () => {
    const { POST } = await import("@/app/api/admin/create-user/route");
    const response = await POST(request({ phone: "+84 912-345-678" }));

    expect(response.status).toBe(200);
    expect(state.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: expect.stringMatching(/^staff-[0-9a-f-]+@auth\.onebiz\.invalid$/),
        password: "password-123",
        email_confirm: true,
        user_metadata: expect.objectContaining({
          phone: "0912345678",
          contact_email: null,
          internal_login_email: true,
        }),
      }),
    );
    expect(state.profileUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ email: null, phone: "0912345678" }),
      { onConflict: "id" },
    );
    expect(await response.json()).toMatchObject({ success: true, userId: "new-user-1" });
  });

  it("keeps a supplied contact email as the Auth email", async () => {
    const { POST } = await import("@/app/api/admin/create-user/route");
    const response = await POST(request({ email: " Staff@Example.COM " }));

    expect(response.status).toBe(200);
    expect(state.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "staff@example.com",
        user_metadata: expect.objectContaining({ internal_login_email: false }),
      }),
    );
    expect(state.profileUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ email: "staff@example.com", phone: null }),
      { onConflict: "id" },
    );
  });

  it("requires at least an email or a phone number", async () => {
    const { POST } = await import("@/app/api/admin/create-user/route");
    const response = await POST(request({}));

    expect(response.status).toBe(400);
    expect(state.createUser).not.toHaveBeenCalled();
  });

  it("rejects an invalid optional phone number", async () => {
    const { POST } = await import("@/app/api/admin/create-user/route");
    const response = await POST(request({ email: "staff@example.com", phone: "123" }));

    expect(response.status).toBe(400);
    expect(state.createUser).not.toHaveBeenCalled();
  });

  it("removes the Auth user when profile setup fails", async () => {
    state.profileUpsert.mockResolvedValue({ data: null, error: { message: "profile failed" } });
    const { POST } = await import("@/app/api/admin/create-user/route");
    const response = await POST(request({ phone: "0912345678" }));

    expect(response.status).toBe(500);
    expect(state.deleteUser).toHaveBeenCalledWith("new-user-1");
  });
});
