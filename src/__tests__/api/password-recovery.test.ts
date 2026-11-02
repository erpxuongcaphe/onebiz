import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ send: vi.fn(), allowed: true }));
vi.mock("@/lib/auth/recovery-client", () => ({ createRecoveryClient: () => ({ auth: { resetPasswordForEmail: state.send } }) }));
vi.mock("@/lib/rate-limit", () => ({ getClientIp: () => "test-ip", checkRateLimit: () => ({ allowed: state.allowed }) }));
import { POST } from "@/app/api/auth/password-recovery/route";
const request = (body: unknown) => new NextRequest("https://onebiz.com.vn/api/auth/password-recovery", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_ONEBIZ_EMAIL_RECOVERY_ENABLED", "true"); vi.clearAllMocks(); state.allowed = true; state.send.mockResolvedValue({ error: null }); });
describe("public password recovery", () => {
  it("does not send email before SMTP is enabled", async () => { vi.stubEnv("NEXT_PUBLIC_ONEBIZ_EMAIL_RECOVERY_ENABLED", "false"); expect((await POST(request({ email: "user@example.com" }))).status).toBe(503); expect(state.send).not.toHaveBeenCalled(); });
  it.each(["0912345678", "staff-1@auth.onebiz.invalid", "invalid", ""])("does not look up or send for %s", async email => {
    expect((await POST(request({ email }))).status).toBe(400); expect(state.send).not.toHaveBeenCalled();
  });
  it("does not accept a caller-supplied recovery destination", async () => {
    const response = await POST(request({ email: "Staff@Example.COM", redirectTo: "https://attacker.test" }));
    expect(response.status).toBe(200); expect(state.send).toHaveBeenCalledWith("staff@example.com", { redirectTo: "https://onebiz.com.vn/dat-lai-mat-khau" }); expect(await response.text()).not.toContain("tồn tại");
  });
  it("blocks repeated requests before reaching Auth", async () => { state.allowed = false; expect((await POST(request({ email: "user@example.com" }))).status).toBe(429); expect(state.send).not.toHaveBeenCalled(); });
  it("reports unavailable SMTP instead of pretending the email was delivered", async () => { state.send.mockResolvedValue({ error: { status: 500 } }); expect((await POST(request({ email: "user@example.com" }))).status).toBe(503); });
});
