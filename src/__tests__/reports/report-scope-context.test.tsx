import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useLayoutEffect, useSyncExternalStore, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Branch } from "@/lib/types/auth";

const state = vi.hoisted(() => ({
  user: { id: "user-a", branchId: "a" } as { id: string; branchId: string; isActive?: boolean }, tenant: { id: "tenant-a" },
  activeBranchId: "a" as string | undefined, branches: [] as Branch[],
  permissions: new Set<string>(), isLoading: false, authDataError: null as string | null,
  effectiveAll: null as boolean | null,
  routerUrl: null as string | null,
  switchBranch: vi.fn(), reads: vi.fn(),
}));
vi.mock("@/lib/contexts/auth-context", () => ({ useAuth: () => ({ ...state,
  currentBranch: state.branches.find(branch => branch.id === state.activeBranchId) ?? null,
  hasPermission: (permission: string) => permission === "reports.view_all_branches" && state.effectiveAll !== null
    ? state.effectiveAll : state.permissions.has(permission),
}) }));
vi.mock("next/navigation", () => ({
  usePathname: () => { useSyncExternalStore(subscribeRouter, () => window.location.href); return state.routerUrl ? new URL(state.routerUrl, window.location.origin).pathname : window.location.pathname; },
  useSearchParams: () => { useSyncExternalStore(subscribeRouter, () => window.location.href); return new URLSearchParams(state.routerUrl ? new URL(state.routerUrl, window.location.origin).search : window.location.search); },
}));
function subscribeRouter(notify: () => void) {
  window.addEventListener("test:next-navigation", notify);
  return () => window.removeEventListener("test:next-navigation", notify);
}
function navigate(url: string, historyState: unknown = {}) {
  window.history.pushState(historyState, "", url);
  window.dispatchEvent(new Event("test:next-navigation"));
}
import { ReportScopeProvider } from "@/lib/contexts/report-scope-context";
import { useReportScope } from "@/lib/hooks/use-report-scope";
import { useBranchFilter } from "@/lib/contexts/use-branch-filter";
import { ReportScopeSelector } from "@/components/shared/report/report-scope-selector";

const branch = (id: string, tenantId = "tenant-a"): Branch => ({
  id, tenantId, name: `Branch ${id}`, isDefault: id === "a", branchType: "store", createdAt: "2026-01-01T00:00:00Z",
});
function Consumer({ name = "report", selectorOnly = false }: { name?: string; selectorOnly?: boolean }) {
  const report = useReportScope({ synchronizeUrl: false });
  const filter = useBranchFilter();
  useEffect(() => { if (!selectorOnly && filter.isReady) state.reads(name, filter.activeBranchId); }, [name, selectorOnly, filter.activeBranchId, filter.isReady]);
  return <section aria-label={name}>
    <output aria-label={`${name} branch`}>{filter.isReady ? filter.activeBranchId ?? "all" : "not-ready"}</output>
    <output aria-label={`${name} label`}>{filter.branchLabel}</output>
    <output aria-label={`${name} scope`}>{report.scopeKey}</output>
    <output aria-label={`${name} all`}>{String(report.canViewAll)}</output>
    <output aria-label={`${name} branches`}>{report.branches.map(branch => branch.id).join(",")}</output>
    <button onClick={() => report.selectBranch("b")}>{name} choose B</button>
    <button onClick={() => report.selectBranch("a")}>{name} choose A</button>
    <button onClick={() => report.selectBranch(null)}>{name} choose all</button>
    <button onClick={() => report.selectBranch("foreign")}>{name} choose foreign</button>
    <button onClick={() => filter.switchBranch("b")}>{name} hook B</button>
  </section>;
}
const Report = ({ children }: { children?: ReactNode }) => <ReportScopeProvider><Consumer />{children}</ReportScopeProvider>;

beforeEach(() => {
  state.user = { id: "user-a", branchId: "a" }; state.tenant = { id: "tenant-a" };
  state.activeBranchId = "a"; state.branches = [branch("a"), branch("b")];
  state.permissions = new Set(["reports.analytics", "reports.view_detail"]);
  state.isLoading = false; state.authDataError = null;
  state.effectiveAll = null;
  state.routerUrl = null;
  state.switchBranch.mockReset(); state.reads.mockReset();
  window.history.replaceState({}, "", "/phan-tich/aging?branch=a&view=table&from=2026-01-01#detail");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("isolated report-only branch scope", () => {
  it("shares report selection across hooks/selector without touching Auth, localStorage or an outside POS consumer", () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    render(<><Consumer name="POS" /><Report><Consumer name="selector" selectorOnly /></Report></>);
    fireEvent.click(screen.getByText("selector choose B"));
    expect(screen.getByLabelText("report branch")).toHaveTextContent("b");
    expect(screen.getByLabelText("selector branch")).toHaveTextContent("b");
    expect(screen.getByLabelText("POS branch")).toHaveTextContent("a");
    expect(state.activeBranchId).toBe("a"); expect(state.switchBranch).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
    const url = new URL(window.location.href);
    expect(url.searchParams.get("branch")).toBe("b"); expect(url.searchParams.get("view")).toBe("table");
    expect(url.searchParams.get("from")).toBe("2026-01-01"); expect(url.hash).toBe("#detail");
    fireEvent.click(screen.getByText("report hook B"));
    expect(state.switchBranch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("POS hook B"));
    expect(state.switchBranch).toHaveBeenCalledExactlyOnceWith("b");
  });
  it("resolves deep links before the first authorized report read", () => {
    window.history.replaceState({}, "", "/phan-tich/aging?branch=b&view=chart");
    const storage = vi.spyOn(Storage.prototype, "setItem");
    render(<Report />);
    expect(state.reads.mock.calls).toEqual([["report", "b"]]);
    expect(state.switchBranch).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
  });
  it.each([true, false])("inherits operational All on first absent query only when authorized=%s", authorized => {
    state.activeBranchId = undefined;
    if (authorized) state.permissions.add("reports.view_all_branches");
    window.history.replaceState({}, "", "/phan-tich/aging?view=chart");
    render(<Report />);
    expect(state.reads.mock.calls).toEqual([["report", authorized ? undefined : "a"]]);
    expect(new URLSearchParams(window.location.search).get("branch")).toBe(authorized ? "all" : "a");
    expect(state.switchBranch).not.toHaveBeenCalled();
  });
  it.each(["unknown", "", "foreign"])("does not broaden invalid explicit %j to operational All", requested => {
    state.activeBranchId = undefined; state.permissions.add("reports.view_all_branches");
    window.history.replaceState({}, "", `/phan-tich/aging?branch=${requested}`);
    render(<Report />);
    expect(state.reads.mock.calls).toEqual([["report", "a"]]);
    expect(new URLSearchParams(window.location.search).get("branch")).toBe("a");
  });
  it("waits for auth before inheriting All from an absent query", () => {
    state.activeBranchId = undefined; state.permissions.add("reports.view_all_branches"); state.isLoading = true;
    window.history.replaceState({}, "", "/phan-tich/aging?view=chart");
    const view = render(<Report />);
    expect(state.reads).not.toHaveBeenCalled();
    expect(new URLSearchParams(window.location.search).has("branch")).toBe(false);
    state.isLoading = false; view.rerender(<Report />);
    expect(state.reads.mock.calls).toEqual([["report", undefined]]);
    expect(new URLSearchParams(window.location.search).get("branch")).toBe("all");
  });
  it("keeps remembered B across absent-query links even when operational All is authorized", () => {
    state.activeBranchId = undefined; state.permissions.add("reports.view_all_branches");
    window.history.replaceState({}, "", "/phan-tich/aging");
    render(<Report />); fireEvent.click(screen.getByText("report choose B"));
    act(() => navigate("/phan-tich/trung-tam?view=table"));
    expect(screen.getByLabelText("report branch")).toHaveTextContent("b");
    expect(new URLSearchParams(window.location.search).get("branch")).toBe("b");
  });
  it("does not re-inherit All after permission revocation and restoration", () => {
    state.activeBranchId = undefined; state.permissions.add("reports.view_all_branches");
    window.history.replaceState({}, "", "/phan-tich/aging");
    const view = render(<Report />);
    expect(screen.getByLabelText("report branch")).toHaveTextContent("all");
    state.permissions.delete("reports.view_all_branches"); view.rerender(<Report />);
    expect(screen.getByLabelText("report branch")).toHaveTextContent("a");
    state.permissions.add("reports.view_all_branches"); view.rerender(<Report />);
    expect(screen.getByLabelText("report branch")).toHaveTextContent("a");
    expect(new URLSearchParams(window.location.search).get("branch")).toBe("a");
  });
  it.each(["all", "foreign", "", "unknown"])("clamps unauthorized/invalid URL branch %j before reading", requested => {
    window.history.replaceState({}, "", `/phan-tich/aging?branch=${requested}&view=chart`);
    render(<Report />);
    expect(state.reads.mock.calls).toEqual([["report", "a"]]);
    expect(new URLSearchParams(window.location.search).get("branch")).toBe("a");
    expect(state.switchBranch).not.toHaveBeenCalled();
  });
  it("never offers or loads all while auth is restoring, even with a cached all permission", () => {
    state.isLoading = true; state.activeBranchId = undefined;
    state.permissions.add("reports.view_all_branches");
    window.history.replaceState({}, "", "/phan-tich/aging?branch=all");
    const view = render(<Report />);
    expect(screen.getByLabelText("report branch")).toHaveTextContent("not-ready");
    expect(screen.getByLabelText("report all")).toHaveTextContent("false");
    expect(state.reads).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("report choose B")); expect(state.reads).not.toHaveBeenCalled();
    state.isLoading = false; view.rerender(<Report />);
    expect(state.reads.mock.calls).toEqual([["report", undefined]]);
    expect(screen.getByLabelText("report label")).toHaveTextContent("Tất cả chi nhánh");
  });
  it("does not infer all permission from branch administration", () => {
    state.permissions.add("system.manage_branches");
    render(<Report />);
    fireEvent.click(screen.getByText("report choose all"));
    fireEvent.click(screen.getByText("report choose foreign"));
    expect(screen.getByLabelText("report branch")).toHaveTextContent("a");
    expect(state.reads.mock.calls).toEqual([["report", "a"]]);
  });
  it.each([false, true])("honors effective owner All with sparse raw permissions, explicit URL=%s", explicit => {
    state.effectiveAll = true; state.activeBranchId = undefined;
    expect(state.permissions.has("reports.view_all_branches")).toBe(false);
    window.history.replaceState({}, "", explicit ? "/phan-tich/aging?branch=all" : "/phan-tich/aging");
    render(<Report />);
    expect(screen.getByLabelText("report all")).toHaveTextContent("true");
    expect(state.reads.mock.calls).toEqual([["report", undefined]]);
    expect(new URLSearchParams(window.location.search).get("branch")).toBe("all");
    fireEvent.click(screen.getByText("report choose B")); fireEvent.click(screen.getByText("report choose all"));
    expect(screen.getByLabelText("report branch")).toHaveTextContent("all");
    expect(state.switchBranch).not.toHaveBeenCalled();
  });
  it.each(["admin", "manager"])("honors denied effective All for %s even if raw permissions contain the code", () => {
    state.effectiveAll = false; state.activeBranchId = undefined;
    state.permissions.add("reports.view_all_branches");
    window.history.replaceState({}, "", "/phan-tich/aging?branch=all");
    render(<Report />);
    expect(screen.getByLabelText("report all")).toHaveTextContent("false");
    expect(state.reads.mock.calls).toEqual([["report", "a"]]);
    fireEvent.click(screen.getByText("report choose all"));
    expect(new URLSearchParams(window.location.search).get("branch")).toBe("a");
    expect(state.switchBranch).not.toHaveBeenCalled();
  });
  it.each(["loading", "error", "inactive"])("does not honor cached effective All before the %s guard clears", guard => {
    state.effectiveAll = true; state.activeBranchId = undefined;
    if (guard === "loading") state.isLoading = true;
    if (guard === "error") state.authDataError = "Unavailable";
    if (guard === "inactive") state.user.isActive = false;
    window.history.replaceState({}, "", "/phan-tich/aging?branch=all");
    render(<Report />);
    expect(screen.getByLabelText("report all")).toHaveTextContent("false");
    expect(state.reads).not.toHaveBeenCalled();
  });
  it("clamps effective callback revocation even when raw permissions do not change", () => {
    state.effectiveAll = true; state.activeBranchId = undefined;
    window.history.replaceState({}, "", "/phan-tich/aging?branch=all");
    const view = render(<Report />);
    expect(screen.getByLabelText("report branch")).toHaveTextContent("all");
    state.effectiveAll = false; view.rerender(<Report />);
    expect(screen.getByLabelText("report all")).toHaveTextContent("false");
    expect(screen.getByLabelText("report branch")).toHaveTextContent("a");
    expect(state.switchBranch).not.toHaveBeenCalled();
  });
  it("keeps report-only selection across ReportCenter/other report links without branch", () => {
    render(<Report />); fireEvent.click(screen.getByText("report choose B"));
    act(() => navigate("/phan-tich/trung-tam?view=chart", { marker: "next" }));
    expect(screen.getByLabelText("report branch")).toHaveTextContent("b");
    expect(new URLSearchParams(window.location.search).get("branch")).toBe("b");
    expect(window.history.state).toEqual({ marker: "next" });
    act(() => navigate("/phan-tich/ban-hang?preset=today"));
    expect(screen.getByLabelText("report branch")).toHaveTextContent("b");
    expect(new URLSearchParams(window.location.search).get("preset")).toBe("today");
    expect(state.switchBranch).not.toHaveBeenCalled();
  });
  it("restores explicit branch/all Back and Forward history without changing operational scope", async () => {
    state.permissions.add("reports.view_all_branches");
    render(<Report />);
    act(() => navigate("/phan-tich/aging?branch=b&view=chart"));
    act(() => navigate("/phan-tich/aging?branch=all&view=table"));
    expect(screen.getByLabelText("report branch")).toHaveTextContent("all");
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByLabelText("report branch")).toHaveTextContent("b"));
    act(() => window.history.forward());
    await waitFor(() => expect(screen.getByLabelText("report branch")).toHaveTextContent("all"));
    expect(state.activeBranchId).toBe("a"); expect(state.switchBranch).not.toHaveBeenCalled();
  });
  it("clamps permission/assignment revocation and never loads unassigned or foreign branches", () => {
    state.permissions.add("reports.view_all_branches");
    const view = render(<Report />); fireEvent.click(screen.getByText("report choose all"));
    state.permissions.delete("reports.view_all_branches"); view.rerender(<Report />);
    expect(screen.getByLabelText("report branch")).toHaveTextContent("a");
    expect(new URLSearchParams(window.location.search).get("branch")).toBe("a");
    fireEvent.click(screen.getByText("report choose B"));
    state.branches = [branch("a"), branch("foreign", "other-tenant")]; view.rerender(<Report />);
    expect(screen.getByLabelText("report branch")).toHaveTextContent("a");
    expect(screen.getByLabelText("report branches")).toHaveTextContent(/^a$/);
    expect(state.switchBranch).not.toHaveBeenCalled();
  });
  it.each(["empty", "error"])("stays fail-closed when branch authorization is %s", reason => {
    if (reason === "empty") state.branches = [];
    else state.authDataError = "Authorization unavailable";
    render(<Report />); fireEvent.click(screen.getByText("report choose all"));
    expect(screen.getByLabelText("report branch")).toHaveTextContent("not-ready");
    expect(state.reads).not.toHaveBeenCalled(); expect(state.switchBranch).not.toHaveBeenCalled();
  });
  it("does not interpret report URLs outside its provider or rewrite a POS navigation", () => {
    window.history.replaceState({}, "", "/?branch=b");
    const view = render(<Consumer name="dashboard" />);
    expect(screen.getByLabelText("dashboard branch")).toHaveTextContent("a");
    expect(new URLSearchParams(window.location.search).get("branch")).toBe("b");
    fireEvent.click(screen.getByText("dashboard choose B")); expect(state.switchBranch).not.toHaveBeenCalled();
    view.unmount();
    window.history.replaceState({}, "", "/phan-tich/aging?branch=a");
    render(<Report />);
    act(() => navigate("/pos?table=fake"));
    expect(screen.getByLabelText("report branch")).toHaveTextContent("not-ready");
    expect(new URLSearchParams(window.location.search).has("branch")).toBe(false);
    expect(state.switchBranch).not.toHaveBeenCalled();
  });
  it("does not reset a report selection when the independent Auth branch changes", () => {
    const view = render(<Report />); fireEvent.click(screen.getByText("report choose B"));
    state.activeBranchId = undefined; view.rerender(<Report />);
    expect(screen.getByLabelText("report branch")).toHaveTextContent("b");
    expect(state.switchBranch).not.toHaveBeenCalled();
  });
  it("never replaces Next/browser history methods, including selection and cleanup", () => {
    const push = window.history.pushState, replace = window.history.replaceState;
    const view = render(<Report />);
    fireEvent.click(screen.getByText("report choose B"));
    expect(window.history.pushState).toBe(push); expect(window.history.replaceState).toBe(replace);
    view.unmount();
    expect(window.history.pushState).toBe(push); expect(window.history.replaceState).toBe(replace);
  });
  it("selects through the actual shared selector without writing the operational branch", () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    render(<ReportScopeProvider><ReportScopeSelector /><Consumer /></ReportScopeProvider>);
    fireEvent.click(screen.getByRole("combobox", { name: "Chi nhánh báo cáo" }));
    fireEvent.click(screen.getByRole("option", { name: "Branch b" }));
    expect(screen.getByLabelText("report branch")).toHaveTextContent("b");
    expect(state.activeBranchId).toBe("a"); expect(state.switchBranch).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
  });
  it("does not change scope identity for date/view-only native URL updates", () => {
    render(<Report />);
    const scope = screen.getByLabelText("report scope").textContent;
    act(() => {
      window.history.replaceState({ next: true }, "", "/phan-tich/aging?branch=a&view=chart&from=2026-02-01");
      window.dispatchEvent(new Event("test:next-navigation"));
    });
    expect(screen.getByLabelText("report scope")).toHaveTextContent(scope!);
    expect(state.reads.mock.calls).toEqual([["report", "a"]]);
  });
  it("does not change branch scope identity on date-only Back/Forward", async () => {
    render(<Report />);
    const scope = screen.getByLabelText("report scope").textContent;
    act(() => navigate("/phan-tich/aging?branch=a&from=2026-02-01"));
    act(() => window.history.back());
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("from")).toBe("2026-01-01"));
    expect(screen.getByLabelText("report scope")).toHaveTextContent(scope!);
    act(() => window.history.forward());
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("from")).toBe("2026-02-01"));
    expect(screen.getByLabelText("report scope")).toHaveTextContent(scope!);
  });
  it.each([
    { initial: "all", target: "/phan-tich/aging?preset=thisMonth&view=table#detail", expected: "all" },
    { initial: "b", target: "/phan-tich/aging?preset=thisMonth&view=table#detail", expected: "b" },
    { initial: "b", target: "/phan-tich/aging?branch=b&preset=thisMonth&view=table#detail", expected: "b" },
    { initial: "all", target: "/phan-tich/aging?branch=b&preset=thisMonth&view=table#detail", expected: "b" },
  ])("canonicalizes speculative Next handoff from $initial to $target before any destination read", ({ initial, target, expected }) => {
    state.effectiveAll = true;
    window.history.replaceState({ previous: true }, "", `/phan-tich/fnb-shipper?branch=${initial}`);
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const reads: Array<{ branch: string | undefined; path: string; query: string | null }> = [];
    const rendered: Array<{ ready: boolean; browserPath: string }> = [];
    function CommitAndRead({ destination }: { destination: string | null }) {
      const scope = useReportScope();
      if (destination) rendered.push({ ready: scope.isReady, browserPath: window.location.pathname });
      useLayoutEffect(() => {
        if (destination) window.history.replaceState({ navigation: "committed" }, "", destination);
      }, [destination]);
      useEffect(() => {
        if (scope.isReady) reads.push({ branch: scope.activeBranchId, path: window.location.pathname,
          query: new URLSearchParams(window.location.search).get("branch") });
      }, [scope.isReady, scope.activeBranchId, destination]);
      return <Consumer selectorOnly />;
    }
    const view = render(<ReportScopeProvider><CommitAndRead destination={null} /></ReportScopeProvider>);
    reads.length = 0;
    // Router hooks expose the destination in render; window still has the old
    // route until the layout effect, matching Next's speculative navigation order.
    state.routerUrl = target;
    view.rerender(<ReportScopeProvider><CommitAndRead destination={target} /></ReportScopeProvider>);
    expect(rendered[0]).toEqual({ ready: false, browserPath: "/phan-tich/fnb-shipper" });
    expect(reads).toEqual([{ branch: expected === "all" ? undefined : expected, path: "/phan-tich/aging", query: expected }]);
    const url = new URL(window.location.href);
    expect(url.searchParams.get("branch")).toBe(expected);
    expect(url.searchParams.get("preset")).toBe("thisMonth");
    expect(url.searchParams.get("view")).toBe("table"); expect(url.hash).toBe("#detail");
    expect(window.history.state).toEqual({ navigation: "committed" });
    expect(state.activeBranchId).toBe("a"); expect(state.switchBranch).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
  });
});
