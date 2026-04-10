import type {
  PurchaseOrderEntry,
  PurchaseReturn,
  InputInvoice,
  QueryParams,
  QueryResult,
} from "@/lib/types";
import { simulateDelay, paginateData, searchFilter } from "../base";

// ==================== Purchase Order Entries (Đặt hàng nhập) ====================

const mockPurchaseOrderEntries: PurchaseOrderEntry[] = [
  { id: "1", code: "DHN000001", date: "2026-03-30T10:00:00", supplierName: "Công ty TNHH Phát Đạt", totalAmount: 32000000, status: "pending", statusName: "Chờ nhập", expectedDate: "2026-04-05", createdBy: "Nguyễn Văn A" },
  { id: "2", code: "DHN000002", date: "2026-03-29T14:30:00", supplierName: "Công ty CP Thành Công", totalAmount: 18500000, status: "completed", statusName: "Hoàn thành", expectedDate: "2026-04-02", createdBy: "Trần Thị B" },
  { id: "3", code: "DHN000003", date: "2026-03-28T09:15:00", supplierName: "Công ty TNHH Minh Quang", totalAmount: 45000000, status: "partial", statusName: "Nhập một phần", expectedDate: "2026-04-03", createdBy: "Lê Văn C" },
  { id: "4", code: "DHN000004", date: "2026-03-27T16:00:00", supplierName: "Công ty TNHH Hòa Bình", totalAmount: 12800000, status: "pending", statusName: "Chờ nhập", expectedDate: "2026-04-06", createdBy: "Phạm Thị D" },
  { id: "5", code: "DHN000005", date: "2026-03-26T08:30:00", supplierName: "Công ty CP Đại Việt", totalAmount: 27600000, status: "cancelled", statusName: "Đã hủy", expectedDate: "2026-04-01", createdBy: "Nguyễn Văn A" },
  { id: "6", code: "DHN000006", date: "2026-03-25T11:00:00", supplierName: "Công ty TNHH An Phú", totalAmount: 56000000, status: "completed", statusName: "Hoàn thành", expectedDate: "2026-03-30", createdBy: "Trần Thị B" },
  { id: "7", code: "DHN000007", date: "2026-03-24T13:45:00", supplierName: "Công ty TNHH Phát Đạt", totalAmount: 21300000, status: "pending", statusName: "Chờ nhập", expectedDate: "2026-04-04", createdBy: "Lê Văn C" },
  { id: "8", code: "DHN000008", date: "2026-03-23T15:15:00", supplierName: "Công ty CP Thành Công", totalAmount: 9800000, status: "completed", statusName: "Hoàn thành", expectedDate: "2026-03-28", createdBy: "Phạm Thị D" },
  { id: "9", code: "DHN000009", date: "2026-03-22T10:30:00", supplierName: "Công ty TNHH Minh Quang", totalAmount: 38500000, status: "partial", statusName: "Nhập một phần", expectedDate: "2026-04-01", createdBy: "Nguyễn Văn A" },
  { id: "10", code: "DHN000010", date: "2026-03-21T08:00:00", supplierName: "Công ty TNHH Hòa Bình", totalAmount: 15200000, status: "pending", statusName: "Chờ nhập", expectedDate: "2026-04-07", createdBy: "Trần Thị B" },
  { id: "11", code: "DHN000011", date: "2026-03-20T14:00:00", supplierName: "Công ty CP Đại Việt", totalAmount: 42000000, status: "completed", statusName: "Hoàn thành", expectedDate: "2026-03-26", createdBy: "Lê Văn C" },
  { id: "12", code: "DHN000012", date: "2026-03-19T09:30:00", supplierName: "Công ty TNHH An Phú", totalAmount: 8700000, status: "cancelled", statusName: "Đã hủy", expectedDate: "2026-03-25", createdBy: "Phạm Thị D" },
  { id: "13", code: "DHN000013", date: "2026-03-18T16:30:00", supplierName: "Công ty TNHH Phát Đạt", totalAmount: 29000000, status: "partial", statusName: "Nhập một phần", expectedDate: "2026-03-28", createdBy: "Nguyễn Văn A" },
  { id: "14", code: "DHN000014", date: "2026-03-17T11:15:00", supplierName: "Công ty CP Thành Công", totalAmount: 16400000, status: "pending", statusName: "Chờ nhập", expectedDate: "2026-04-08", createdBy: "Trần Thị B" },
  { id: "15", code: "DHN000015", date: "2026-03-16T08:45:00", supplierName: "Công ty TNHH Minh Quang", totalAmount: 53000000, status: "completed", statusName: "Hoàn thành", expectedDate: "2026-03-22", createdBy: "Lê Văn C" },
  { id: "16", code: "DHN000016", date: "2026-03-15T13:00:00", supplierName: "Công ty TNHH Hòa Bình", totalAmount: 11500000, status: "completed", statusName: "Hoàn thành", expectedDate: "2026-03-20", createdBy: "Phạm Thị D" },
  { id: "17", code: "DHN000017", date: "2026-03-14T15:30:00", supplierName: "Công ty CP Đại Việt", totalAmount: 34200000, status: "pending", statusName: "Chờ nhập", expectedDate: "2026-04-10", createdBy: "Nguyễn Văn A" },
  { id: "18", code: "DHN000018", date: "2026-03-13T10:00:00", supplierName: "Công ty TNHH An Phú", totalAmount: 19800000, status: "partial", statusName: "Nhập một phần", expectedDate: "2026-03-24", createdBy: "Trần Thị B" },
];

export async function getPurchaseOrderEntries(params: QueryParams): Promise<QueryResult<PurchaseOrderEntry>> {
  await simulateDelay();
  let filtered = searchFilter(mockPurchaseOrderEntries, params.search, ["code", "supplierName"]);

  if (params.filters?.status && params.filters.status !== "all") {
    filtered = filtered.filter((item) => item.status === params.filters!.status);
  }

  return paginateData(filtered, params.page, params.pageSize);
}

export function getPurchaseOrderStatuses() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "pending", label: "Chờ nhập" },
    { value: "partial", label: "Nhập một phần" },
    { value: "completed", label: "Hoàn thành" },
    { value: "cancelled", label: "Đã hủy" },
  ];
}

// ==================== Purchase Returns (Trả hàng nhập) ====================

const mockPurchaseReturns: PurchaseReturn[] = [
  { id: "1", code: "THN000001", date: "2026-03-30T10:00:00", importCode: "NH000012", supplierName: "Công ty TNHH Phát Đạt", totalAmount: 8500000, status: "completed", statusName: "Hoàn thành", createdBy: "Nguyễn Văn A" },
  { id: "2", code: "THN000002", date: "2026-03-28T14:30:00", importCode: "NH000015", supplierName: "Công ty CP Thành Công", totalAmount: 3200000, status: "completed", statusName: "Hoàn thành", createdBy: "Trần Thị B" },
  { id: "3", code: "THN000003", date: "2026-03-27T09:00:00", importCode: "NH000018", supplierName: "Công ty TNHH Minh Quang", totalAmount: 12500000, status: "draft", statusName: "Phiếu tạm", createdBy: "Lê Văn C" },
  { id: "4", code: "THN000004", date: "2026-03-25T16:15:00", importCode: "NH000020", supplierName: "Công ty TNHH Hòa Bình", totalAmount: 4800000, status: "completed", statusName: "Hoàn thành", createdBy: "Phạm Thị D" },
  { id: "5", code: "THN000005", date: "2026-03-24T11:30:00", importCode: "NH000022", supplierName: "Công ty CP Đại Việt", totalAmount: 15600000, status: "draft", statusName: "Phiếu tạm", createdBy: "Nguyễn Văn A" },
  { id: "6", code: "THN000006", date: "2026-03-22T08:45:00", importCode: "NH000025", supplierName: "Công ty TNHH An Phú", totalAmount: 6700000, status: "completed", statusName: "Hoàn thành", createdBy: "Trần Thị B" },
  { id: "7", code: "THN000007", date: "2026-03-20T13:00:00", importCode: "NH000028", supplierName: "Công ty TNHH Phát Đạt", totalAmount: 9200000, status: "completed", statusName: "Hoàn thành", createdBy: "Lê Văn C" },
  { id: "8", code: "THN000008", date: "2026-03-19T15:30:00", importCode: "NH000030", supplierName: "Công ty CP Thành Công", totalAmount: 2100000, status: "draft", statusName: "Phiếu tạm", createdBy: "Phạm Thị D" },
  { id: "9", code: "THN000009", date: "2026-03-17T10:15:00", importCode: "NH000033", supplierName: "Công ty TNHH Minh Quang", totalAmount: 18300000, status: "completed", statusName: "Hoàn thành", createdBy: "Nguyễn Văn A" },
  { id: "10", code: "THN000010", date: "2026-03-16T09:00:00", importCode: "NH000035", supplierName: "Công ty TNHH Hòa Bình", totalAmount: 5400000, status: "completed", statusName: "Hoàn thành", createdBy: "Trần Thị B" },
];

export async function getPurchaseReturns(params: QueryParams): Promise<QueryResult<PurchaseReturn>> {
  await simulateDelay();
  let filtered = searchFilter(mockPurchaseReturns, params.search, ["code"]);

  if (params.filters?.status && params.filters.status !== "all") {
    filtered = filtered.filter((item) => item.status === params.filters!.status);
  }

  return paginateData(filtered, params.page, params.pageSize);
}

export function getPurchaseReturnStatuses() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "completed", label: "Hoàn thành" },
    { value: "draft", label: "Phiếu tạm" },
  ];
}

// ==================== Input Invoices (Hóa đơn đầu vào) ====================

let mockInputInvoices: InputInvoice[] = [
  { id: "1", code: "HDDV000001", date: "2026-03-30T10:00:00", supplierName: "Công ty TNHH Phát Đạt", totalAmount: 25000000, taxAmount: 2500000, status: "recorded", statusName: "Đã ghi sổ", createdBy: "Nguyễn Văn A" },
  { id: "2", code: "HDDV000002", date: "2026-03-29T14:30:00", supplierName: "Công ty CP Thành Công", totalAmount: 18500000, taxAmount: 1850000, status: "recorded", statusName: "Đã ghi sổ", createdBy: "Trần Thị B" },
  { id: "3", code: "HDDV000003", date: "2026-03-28T09:00:00", supplierName: "Công ty TNHH Minh Quang", totalAmount: 42000000, taxAmount: 4200000, status: "unrecorded", statusName: "Chưa ghi sổ", createdBy: "Lê Văn C" },
  { id: "4", code: "HDDV000004", date: "2026-03-27T16:15:00", supplierName: "Công ty TNHH Hòa Bình", totalAmount: 9800000, taxAmount: 980000, status: "recorded", statusName: "Đã ghi sổ", createdBy: "Phạm Thị D" },
  { id: "5", code: "HDDV000005", date: "2026-03-26T11:30:00", supplierName: "Công ty CP Đại Việt", totalAmount: 35600000, taxAmount: 3560000, status: "unrecorded", statusName: "Chưa ghi sổ", createdBy: "Nguyễn Văn A" },
  { id: "6", code: "HDDV000006", date: "2026-03-25T08:45:00", supplierName: "Công ty TNHH Phát Đạt", totalAmount: 15200000, taxAmount: 1520000, status: "recorded", statusName: "Đã ghi sổ", createdBy: "Trần Thị B" },
  { id: "7", code: "HDDV000007", date: "2026-03-24T13:00:00", supplierName: "Công ty TNHH An Phú", totalAmount: 28700000, taxAmount: 2870000, status: "recorded", statusName: "Đã ghi sổ", createdBy: "Lê Văn C" },
  { id: "8", code: "HDDV000008", date: "2026-03-23T15:30:00", supplierName: "Công ty CP Thành Công", totalAmount: 6500000, taxAmount: 650000, status: "unrecorded", statusName: "Chưa ghi sổ", createdBy: "Phạm Thị D" },
  { id: "9", code: "HDDV000009", date: "2026-03-22T10:15:00", supplierName: "Công ty TNHH Minh Quang", totalAmount: 51000000, taxAmount: 5100000, status: "recorded", statusName: "Đã ghi sổ", createdBy: "Nguyễn Văn A" },
  { id: "10", code: "HDDV000010", date: "2026-03-21T09:00:00", supplierName: "Công ty TNHH Hòa Bình", totalAmount: 12300000, taxAmount: 1230000, status: "recorded", statusName: "Đã ghi sổ", createdBy: "Trần Thị B" },
  { id: "11", code: "HDDV000011", date: "2026-03-20T14:45:00", supplierName: "Công ty CP Đại Việt", totalAmount: 22100000, taxAmount: 2210000, status: "unrecorded", statusName: "Chưa ghi sổ", createdBy: "Lê Văn C" },
  { id: "12", code: "HDDV000012", date: "2026-03-19T11:00:00", supplierName: "Công ty TNHH An Phú", totalAmount: 8900000, taxAmount: 890000, status: "recorded", statusName: "Đã ghi sổ", createdBy: "Phạm Thị D" },
  { id: "13", code: "HDDV000013", date: "2026-03-18T08:30:00", supplierName: "Công ty TNHH Phát Đạt", totalAmount: 31500000, taxAmount: 3150000, status: "recorded", statusName: "Đã ghi sổ", createdBy: "Nguyễn Văn A" },
  { id: "14", code: "HDDV000014", date: "2026-03-17T16:00:00", supplierName: "Công ty CP Thành Công", totalAmount: 14700000, taxAmount: 1470000, status: "unrecorded", statusName: "Chưa ghi sổ", createdBy: "Trần Thị B" },
  { id: "15", code: "HDDV000015", date: "2026-03-16T10:30:00", supplierName: "Công ty TNHH Minh Quang", totalAmount: 47800000, taxAmount: 4780000, status: "recorded", statusName: "Đã ghi sổ", createdBy: "Lê Văn C" },
];

export async function getInputInvoices(params: QueryParams): Promise<QueryResult<InputInvoice>> {
  await simulateDelay();
  let filtered = searchFilter(mockInputInvoices, params.search, ["code", "supplierName"]);

  if (params.filters?.status && params.filters.status !== "all") {
    filtered = filtered.filter((item) => item.status === params.filters!.status);
  }

  return paginateData(filtered, params.page, params.pageSize);
}

export async function deleteInputInvoice(id: string): Promise<void> {
  await simulateDelay();
  const idx = mockInputInvoices.findIndex((item) => item.id === id);
  if (idx !== -1) mockInputInvoices.splice(idx, 1);
}

export async function recordInputInvoice(id: string): Promise<void> {
  await simulateDelay();
  const item = mockInputInvoices.find((inv) => inv.id === id);
  if (item && item.status === "unrecorded") {
    item.status = "recorded";
    item.statusName = "Đã ghi sổ";
  }
}

export function getInputInvoiceStatuses() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "recorded", label: "Đã ghi sổ" },
    { value: "unrecorded", label: "Chưa ghi sổ" },
  ];
}
