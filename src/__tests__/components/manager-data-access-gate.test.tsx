import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: state.redirect }));
import ManagerEntryPage from "@/app/manager/page";
beforeEach(() => {
  state.redirect.mockReset().mockImplementation((url: string) => { throw new Error("REDIRECT:" + url); });
});
describe("manager entry shares the main dashboard", () => {
  it("redirects an installed shortcut without loading another data source", async () => {
    await expect(ManagerEntryPage({})).rejects.toThrow("REDIRECT:/");
    expect(state.redirect).toHaveBeenCalledOnce();
  });
  it.each(["all", "00000000-0000-4000-8000-000000000001", "019a2b39-0000-7000-8000-000000000001"])("preserves requested branch %s for the main scope guard", async branch => {
    await expect(ManagerEntryPage({ searchParams: Promise.resolve({ branch }) })).rejects.toThrow("REDIRECT:/?branch=" + branch);
  });
  it.each(["https://example.com", "../pos", "invalid", ["all", "other"]])("ignores invalid or repeated branch input %s", async branch => {
    await expect(ManagerEntryPage({ searchParams: Promise.resolve({ branch }) })).rejects.toThrow("REDIRECT:/");
    expect(state.redirect).toHaveBeenCalledWith("/");
  });
  it("does not forward unrelated navigation or stale date parameters", async () => {
    await expect(ManagerEntryPage({ searchParams: Promise.resolve({ next: "https://example.com", preset: "thisMonth", from: "2026-10-01", branch: "all" }) })).rejects.toThrow("REDIRECT:/?branch=all");
  });
});
