import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROLE_TEMPLATES, PERMISSIONS } from "@/lib/permissions/constants";
import { FnbOpenOrdersDialog } from "@/app/pos/fnb/components/fnb-open-orders-dialog";

const state = vi.hoisted(() => ({ active: true, loading: false, permissions: new Set<string>() }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ user: { isActive: state.active, role: "cashier" }, isLoading: state.loading, permissions: state.permissions }) }));
import { usePermissions } from "@/lib/permissions/use-permission";

function CashierOrders({ onMerge }: { onMerge: () => void }) {
  const { hasPermission } = usePermissions();
  const canMergeBills = hasPermission(PERMISSIONS.POS_FNB_MANAGE_TABLES) || hasPermission(PERMISSIONS.POS_FNB_MERGE_BILLS);
  return <FnbOpenOrdersDialog open orders={[]} drafts={[]} loading={false} error={null} connected busy={false} updatedAt={null}
    onOpenChange={() => {}} onOpenOrder={() => {}} onOpenDraft={() => {}} onRefresh={() => {}} onMerge={canMergeBills ? onMerge : undefined} />;
}
beforeEach(() => { state.active = true; state.loading = false; state.permissions = new Set([PERMISSIONS.POS_FNB_MERGE_BILLS]); });
afterEach(cleanup);

describe("cashier merge-only permission", () => {
  it("grants merge without table management, voiding, price editing or discounts", () => {
    const grants = DEFAULT_ROLE_TEMPLATES.find(role => role.name === "Thu ngân F&B")!.permissions;
    expect(grants).toContain(PERMISSIONS.POS_FNB_MERGE_BILLS);
    for (const permission of [PERMISSIONS.POS_FNB_MANAGE_TABLES, PERMISSIONS.POS_FNB_VOID_PAID_BILL, PERMISSIONS.POS_FNB_CANCEL_UNPAID_ORDER, PERMISSIONS.POS_FNB_EDIT_PRICE, PERMISSIONS.POS_FNB_DISCOUNT]) expect(grants).not.toContain(permission);
  });
  it("shows the working merge entry with only the new permission", () => {
    const onMerge = vi.fn(); render(<CashierOrders onMerge={onMerge} />);
    fireEvent.click(screen.getByRole("button", { name: "Gộp 2 hoặc nhiều bill…" }));
    expect(onMerge).toHaveBeenCalledOnce();
  });
  it.each(["revoked", "inactive", "loading"])("hides the entry when %s", condition => {
    if (condition === "revoked") state.permissions.clear();
    if (condition === "inactive") state.active = false;
    if (condition === "loading") state.loading = true;
    render(<CashierOrders onMerge={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Gộp 2 hoặc nhiều bill…" })).not.toBeInTheDocument();
  });
  it("retains existing table-manager access", () => {
    state.permissions = new Set([PERMISSIONS.POS_FNB_MANAGE_TABLES]);
    render(<CashierOrders onMerge={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Gộp 2 hoặc nhiều bill…" })).toBeEnabled();
  });
  it("wires every POS merge entry and server call to merge access while keeping table creation separate", () => {
    const page = readFileSync("src/app/pos/fnb/page.tsx", "utf8");
    expect(page).toContain("const canMergeBills = canManageTables || hasPermission(PERMISSIONS.POS_FNB_MERGE_BILLS)");
    expect(page.match(/onMergeTable=\{canMergeBills \?/g)).toHaveLength(2);
    expect(page).toMatch(/onMergeTable=\{\s+canMergeBills && networkStatus.isOnline/);
    expect(page).toContain("onMerge={canMergeBills ?");
    expect(page).toContain("canMerge={canMergeBills}");
    expect(page).toContain("mergeIntent && branchId && canMergeBills");
    expect(page).toContain("mergeBillsLock.current || !branchId || !canMergeBills");
    expect(page).toContain("if (!canManageTables)");
  });
});
