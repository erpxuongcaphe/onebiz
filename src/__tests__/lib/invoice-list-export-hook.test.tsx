import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice } from "@/lib/types";
const mocks = vi.hoisted(() => ({ read: vi.fn(), excel: vi.fn(), csv: vi.fn() }));
vi.mock("@/lib/services/supabase/invoice-list-export", () => ({ getInvoicesForFilteredExport: mocks.read }));
vi.mock("@/lib/utils/export", () => ({ exportToExcel: mocks.excel, exportToCsv: mocks.csv }));
import { useInvoiceListExport } from "@/lib/hooks/use-invoice-list-export";
const data = Array.from({ length: 437 }, (_, i) => ({ id: `i${i}`, code: `HD${i}`, totalAmount: 50000, discount: 1000, source: "fnb", fnbOrderType: "takeaway" }) as Invoice);
function options() { return { scope: { mode: "branch" as const, branchId: "a", duocDemChiNhanhKhac: false }, query: { filters: { status: ["completed"] } }, ready: true, allowed: true, fnb: true, onError: vi.fn(), onSuccess: vi.fn() }; }
beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue(data); mocks.excel.mockResolvedValue(undefined); mocks.csv.mockResolvedValue(undefined); });
describe("Invoice export interaction", () => {
  it.each(["excel", "csv"] as const)("passes every filtered row to %s, including type labels and numeric amounts", async type => {
    const opts = options(); const { result } = renderHook(() => useInvoiceListExport(opts));
    await act(async () => { await result.current.start(type); });
    const writer = type === "excel" ? mocks.excel : mocks.csv;
    expect(writer).toHaveBeenCalledTimes(1);
    const [exported, columns] = writer.mock.calls[0];
    expect(exported).toHaveLength(437); expect(exported[436].invoiceTypeLabel).toBe("Mang về");
    expect(exported[436].totalAmount).toBe(50000); expect(columns.map((c: {key:string}) => c.key)).toContain("invoiceTypeLabel");
    expect(columns.map((c: {key:string})=>c.key)).toEqual(expect.arrayContaining(["tableName","tableNumber","areaName","openedAt","paidAt","posNote"]));
    expect(opts.onSuccess).toHaveBeenCalledWith(437); expect(result.current.progress).toBeNull();
  });
  it.each(["cancel", "branch change", "filter change", "unmount"])("does not save stale or partial files after %s", async change => {
    let resolve!: (value: Invoice[]) => void;
    mocks.read.mockReturnValue(new Promise<Invoice[]>(r => { resolve = r; }));
    const opts = options(); const { result, rerender, unmount } = renderHook(props => useInvoiceListExport(props), { initialProps: opts });
    let pending!: Promise<void>;
    act(() => { pending = result.current.start("excel"); void result.current.start("excel"); });
    expect(mocks.read).toHaveBeenCalledTimes(1);
    if (change === "cancel") act(() => result.current.cancel());
    if (change === "branch change") rerender({ ...opts, scope: { ...opts.scope, branchId: "b" } });
    if (change === "filter change") rerender({ ...opts, query: { filters: { status: ["cancelled"] } } });
    if (change === "unmount") unmount();
    await act(async () => { resolve(data); await pending; });
    expect(mocks.excel).not.toHaveBeenCalled(); expect(opts.onSuccess).not.toHaveBeenCalled(); expect(opts.onError).not.toHaveBeenCalled();
  });
  it("guards saving if cancellation happens during lazy file preparation", async () => {
    let finish!: () => void; let guard!: () => boolean;
    mocks.excel.mockImplementation((_data, _columns, _name, options) => { guard = options.shouldSave; return new Promise<void>(r => { finish = r; }); });
    const opts = options(); const { result } = renderHook(() => useInvoiceListExport(opts));
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.start("excel"); });
    expect(guard()).toBe(true); act(() => result.current.cancel()); expect(guard()).toBe(false);
    await act(async () => { finish(); await pending; }); expect(opts.onSuccess).not.toHaveBeenCalled();
  });
  it.each(["permission", "not ready", "empty", "network"])("reports %s without creating a file", async failure => {
    const opts = options();
    if (failure === "permission") opts.allowed = false;
    if (failure === "not ready") opts.ready = false;
    if (failure === "empty") mocks.read.mockResolvedValue([]);
    if (failure === "network") mocks.read.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useInvoiceListExport(opts));
    await act(async () => { await result.current.start("excel"); });
    expect(opts.onError).toHaveBeenCalledTimes(1); expect(mocks.excel).not.toHaveBeenCalled(); expect(result.current.progress).toBeNull();
  });
});
