import type { ReturnOrder, QueryParams, QueryResult } from "@/lib/types";
import { simulateDelay, paginateData, searchFilter } from "../base";

const mockReturns: ReturnOrder[] = [
  { id: "1", code: "TH000001", invoiceCode: "HD000045", date: "2026-03-31T09:00:00", customerName: "Nguyễn Văn An", totalAmount: 450000, status: "completed", statusName: "Hoàn thành", createdBy: "Trần Minh" },
  { id: "2", code: "TH000002", invoiceCode: "HD000038", date: "2026-03-30T14:30:00", customerName: "Trần Thị Bích", totalAmount: 1200000, status: "draft", statusName: "Phiếu tạm", createdBy: "Nguyễn Hà" },
  { id: "3", code: "TH000003", invoiceCode: "HD000032", date: "2026-03-29T10:15:00", customerName: "Lê Hoàng Cường", totalAmount: 380000, status: "completed", statusName: "Hoàn thành", createdBy: "Lê Hương" },
  { id: "4", code: "TH000004", invoiceCode: "HD000028", date: "2026-03-28T16:45:00", customerName: "Phạm Thị Dung", totalAmount: 2350000, status: "completed", statusName: "Hoàn thành", createdBy: "Trần Minh" },
  { id: "5", code: "TH000005", invoiceCode: "HD000025", date: "2026-03-27T08:20:00", customerName: "Hoàng Văn Em", totalAmount: 670000, status: "draft", statusName: "Phiếu tạm", createdBy: "Nguyễn Hà" },
  { id: "6", code: "TH000006", invoiceCode: "HD000021", date: "2026-03-26T13:00:00", customerName: "Vũ Thị Phương", totalAmount: 1890000, status: "completed", statusName: "Hoàn thành", createdBy: "Lê Hương" },
  { id: "7", code: "TH000007", invoiceCode: "HD000018", date: "2026-03-25T11:30:00", customerName: "Đặng Quốc Gia", totalAmount: 540000, status: "completed", statusName: "Hoàn thành", createdBy: "Trần Minh" },
  { id: "8", code: "TH000008", invoiceCode: "HD000015", date: "2026-03-24T15:10:00", customerName: "Bùi Thị Hạnh", totalAmount: 3120000, status: "draft", statusName: "Phiếu tạm", createdBy: "Nguyễn Hà" },
  { id: "9", code: "TH000009", invoiceCode: "HD000012", date: "2026-03-23T09:40:00", customerName: "Ngô Minh Khải", totalAmount: 780000, status: "completed", statusName: "Hoàn thành", createdBy: "Lê Hương" },
  { id: "10", code: "TH000010", invoiceCode: "HD000009", date: "2026-03-22T14:00:00", customerName: "Lý Thị Lan", totalAmount: 1560000, status: "completed", statusName: "Hoàn thành", createdBy: "Trần Minh" },
  { id: "11", code: "TH000011", invoiceCode: "HD000006", date: "2026-03-21T10:50:00", customerName: "Đỗ Văn Mạnh", totalAmount: 4200000, status: "draft", statusName: "Phiếu tạm", createdBy: "Nguyễn Hà" },
  { id: "12", code: "TH000012", invoiceCode: "HD000003", date: "2026-03-20T16:20:00", customerName: "Trịnh Thị Ngọc", totalAmount: 920000, status: "completed", statusName: "Hoàn thành", createdBy: "Lê Hương" },
];

export async function getReturns(params: QueryParams): Promise<QueryResult<ReturnOrder>> {
  await simulateDelay();
  let filtered = searchFilter(mockReturns, params.search, ["code", "invoiceCode"]);

  if (params.filters?.status && params.filters.status !== "all") {
    filtered = filtered.filter((o) => o.status === params.filters!.status);
  }

  return paginateData(filtered, params.page, params.pageSize);
}

export function getReturnStatuses() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "completed", label: "Hoàn thành" },
    { value: "draft", label: "Phiếu tạm" },
  ];
}
