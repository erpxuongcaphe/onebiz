import { beforeEach, expect, it, vi } from "vitest";
import { getStockTransfersForExport } from "@/lib/services/supabase/transfers";
import { exportToExcelFromSchema } from "@/lib/excel/template-builder";
import { stockTransferExcelSchema } from "@/lib/excel/schemas/stock-transfers";
import * as XLSX from "xlsx";

const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), range: vi.fn(), in: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => api }));
vi.mock("file-saver", () => ({ saveAs: api.save }));
const header = { id: "transfer-1", code: "CK-001", status: "completed",
  from_branch: { name: "Sender" }, to_branch: { name: "Receiver" } };
const workspace = (items: unknown[], total: number) => ({ data: { items, total }, error: null });
const line = (i: number) => ({ id: `line-${i}`, transfer_id: header.id,
  product_code: `SKU-${i}`, product_name: "Fixture item", unit: "Cay", quantity: 3 });
const filters = { branchId: "sender", search: "CK-001" };

beforeEach(() => {
  vi.resetAllMocks();
  const query = { select: vi.fn().mockReturnThis(), in: api.in, order: vi.fn().mockReturnThis(), range: api.range };
  api.in.mockReturnValue(query);
  api.from.mockReturnValue(query);
});

it("reads all line pages for only the matched transfer IDs", async () => {
  api.rpc.mockResolvedValue(workspace([header], 1));
  api.range.mockResolvedValueOnce({ data: Array.from({ length: 200 }, (_, i) => line(i)), count: 201, error: null })
    .mockResolvedValueOnce({ data: [line(200)], count: 201, error: null });
  const rows = await getStockTransfersForExport(filters);
  expect(rows).toHaveLength(201);
  expect(rows.at(-1)).toMatchObject({ code: "CK-001", productCode: "SKU-200", unit: "Cay", quantity: 3 });
  expect(api.rpc).toHaveBeenCalledWith("get_stock_transfer_list_workspace",
    expect.objectContaining({ p_branch_id: "sender", p_search: "CK-001" }));
  expect(api.in).toHaveBeenCalledWith("transfer_id", [header.id]);
  expect(api.range.mock.calls).toEqual([[0, 199], [200, 399]]);
  exportToExcelFromSchema(rows, stockTransferExcelSchema);
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(api.save.mock.calls[0][0]);
  });
  const book = XLSX.read(bytes, { type: "array" });
  const cells = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[book.SheetNames[0]], { header: 1 });
  const columns = cells.find(row => row[0] === "Mã phiếu")!;
  const exported = cells.filter(row => row[0] === "CK-001");
  expect(exported).toHaveLength(201);
  expect(["Kho xuất", "Kho nhận", "Mã sản phẩm", "Đơn vị", "Số lượng"].map(label =>
    exported.at(-1)?.[columns.indexOf(label)])).toEqual(["Sender", "Receiver", "SKU-200", "Cay", 3]);
});

it("refuses a short header page when the source reports more results", async () => {
  api.rpc.mockResolvedValue(workspace([header], 201));
  await expect(getStockTransfersForExport(filters)).rejects.toThrow("Chưa tải đủ phiếu chuyển kho");
  expect(api.from).not.toHaveBeenCalled();
});

it("refuses missing or out-of-scope lines", async () => {
  api.rpc.mockResolvedValue(workspace([header], 1));
  api.range.mockResolvedValueOnce({ data: [], count: 1, error: null });
  await expect(getStockTransfersForExport(filters)).rejects.toThrow("Chưa tải đủ");
  api.range.mockResolvedValueOnce({ data: [{ ...line(1), transfer_id: "other" }], count: 1, error: null });
  await expect(getStockTransfersForExport(filters)).rejects.toThrow("không thuộc phiếu");
});
