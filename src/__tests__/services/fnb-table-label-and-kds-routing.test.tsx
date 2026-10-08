import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { composeTableCode, getCompactTableLabel, getTableLabel, suggestZonePrefix } from "@/lib/fnb/table-label";
import { getKdsStationItems } from "@/app/pos/fnb/kds/kds-station-visibility";
import { changeDraftOrderType } from "@/app/pos/fnb/order-type-selection";
import type { FnbTabSnapshot } from "@/lib/types/fnb";

vi.mock("@/lib/contexts/toast-context", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import { TableIdentityEditor } from "@/components/shared/floor-plan/table-identity-editor";
afterEach(cleanup);

describe("area-prefixed table identity", () => {
  it("uses distinct names with the same local ordinal, without changing numeric keys", () => {
    expect(suggestZonePrefix("Trong Nhà")).toBe("TN");
    expect(suggestZonePrefix("Ngoài Sân")).toBe("NS");
    expect(composeTableCode("tn", "1")).toBe("TN 01");
    expect(composeTableCode("NS", "01")).toBe("NS 01");
    expect(getTableLabel({ tableNumber: 10, name: "NS 01" })).toBe("NS 01");
    expect(getCompactTableLabel({ tableNumber: 10, name: "NS 01" })).toBe("NS 01");
    expect(getCompactTableLabel({ tableNumber: 1, name: "Bàn 1" })).toBe("1");
    expect(getTableLabel({ tableNumber: 1, name: " " })).toBe("Bàn 1");
  });
  it.each(["", "0", "1.5", "10000", "-1", "1e2"])("rejects invalid local ordinal %s", ordinal => {
    expect(composeTableCode("TN", ordinal)).toBe("");
  });
  it("suggests an area code without writing and saves NS 01 using the original key", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<TableIdentityEditor table={{ tableNumber: 10, name: "Bàn 10" }} zoneName="Ngoài Sân" onSave={save} />);
    expect(screen.getByLabelText("Ký hiệu khu vực")).toHaveValue("NS");
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Số bàn trong khu"), { target: { value: "1" } });
    expect(screen.getByText("NS 01")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lưu thông tin bàn" }));
    await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith({ tableNumber: 10, name: "NS 01" }));
  });
  it("assigns draft tabs by table ID, not by ordinal or display name", () => {
    const draft: FnbTabSnapshot = { id: "d", label: "Mang về", orderType: "takeaway", lines: [], customerName: "Khách lẻ" };
    const inside = changeDraftOrderType(draft, "dine_in", { id: "inside", tableNumber: 1, name: "TN 01" });
    const outside = changeDraftOrderType(draft, "dine_in", { id: "outside", tableNumber: 10, name: "NS 01" });
    expect(inside).toMatchObject({ label: "TN 01", tableId: "inside" });
    expect(outside).toMatchObject({ label: "NS 01", tableId: "outside" });
    expect(changeDraftOrderType({ ...inside, kitchenOrderId: "sent" }, "dine_in", { id: "outside", tableNumber: 10, name: "NS 01" }).tableId).toBe("inside");
  });
});

describe("KDS versus print-only routing", () => {
  const items = [{ id: "bar", kitchenStationId: "bar" }, { id: "paper", kitchenStationId: "paper" }, { id: "legacy", kitchenStationId: null }];
  const stations = [{ id: "bar", settings: {} }, { id: "paper", settings: { show_on_kds: false } }];
  it("excludes print-only lines even from All, retaining unassigned legacy lines", () => {
    expect(getKdsStationItems(items, stations).map(item => item.id)).toEqual(["bar", "legacy"]);
    expect(items).toHaveLength(3);
  });
  it("does not require KDS for a branch with all stations configured print-only", () => {
    expect(getKdsStationItems(items, stations.map(station => ({ ...station, settings: { show_on_kds: false } })))).toEqual([]);
  });
  it("preserves legacy branch behavior and scopes bulk actions to the selected station", () => {
    expect(getKdsStationItems(items, [])).toEqual(items);
    expect(getKdsStationItems(items, stations, "bar")).toEqual([items[0]]);
    expect(getKdsStationItems(items, stations, "paper")).toEqual([]);
  });
  it("does not hide a paid ticket at a KDS station or change payment state", () => {
    const paid = { invoiceId: "paid", items };
    const projected = { ...paid, items: getKdsStationItems(paid.items, stations) };
    expect(projected.invoiceId).toBe("paid");
    expect(projected.items).toHaveLength(2);
    expect(paid.items).toHaveLength(3);
  });
  it("wires render, overdue alerts and bulk actions to the same station projection", () => {
    const page = readFileSync("src/app/pos/fnb/kds/page.tsx", "utf8");
    expect(page).toContain("const filtered = kdsOrders");
    expect(page).toContain("const order = kdsOrders.find");
    expect(page).toContain("for (const order of kdsOrders)");
    expect(page).toContain("getKitchenStationsByBranch(branchId, { throwOnError: true })");
  });
});
