import type { CashBookEntry, QueryParams, QueryResult } from "@/lib/types";
import { simulateDelay, paginateData, searchFilter } from "../base";

const receiptCategories = [
  "Thu tiền khách hàng",
  "Thu tiền mặt",
  "Thu khác",
];
const paymentCategories = [
  "Chi trả NCC",
  "Chi phí vận chuyển",
  "Chi phí khác",
];
const counterparties = [
  "Nguyễn Minh Tuấn",
  "Trần Thị Hoa",
  "Công ty TNHH ABC Coffee",
  "Lê Văn Đức",
  "Phạm Mai Lan",
  "Hoàng Anh Dũng",
  "NCC Đại Phát",
  "NCC Minh Long",
  "Vũ Thị Ngọc",
  "Quán Cà Phê Bùi Thanh Tâm",
  "Công ty Phân Phối Miền Nam",
  "Giao Hàng Nhanh",
  "Viettel Post",
  "Đỗ Quang Huy",
  "Lê Hoàng Phúc",
];
const creators = ["Nguyễn Văn A", "Trần Thị B", "Lê Văn C", "Phạm Thị D"];
const notes = [
  "Thanh toán đơn hàng",
  "Thu nợ cũ",
  "Thanh toán công nợ NCC",
  "Phí giao hàng tháng 3",
  "Chi phí thuê kho",
  "Thu tiền trả hàng",
  undefined,
  undefined,
  "Tạm ứng",
  "Hoàn tiền khách",
];

function generateCashBookData(): CashBookEntry[] {
  return Array.from({ length: 30 }, (_, i) => {
    const isReceipt = Math.random() > 0.45;
    const type: "receipt" | "payment" = isReceipt ? "receipt" : "payment";
    const categories = isReceipt ? receiptCategories : paymentCategories;
    const daysAgo = Math.floor(Math.random() * 60);
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    date.setHours(
      Math.floor(Math.random() * 12) + 7,
      Math.floor(Math.random() * 60),
    );

    return {
      id: `cb_${i + 1}`,
      code: `${isReceipt ? "PT" : "PC"}${String(i + 1).padStart(5, "0")}`,
      date: date.toISOString(),
      type,
      typeName: isReceipt ? "Phiếu thu" : "Phiếu chi",
      category: categories[Math.floor(Math.random() * categories.length)],
      counterparty:
        counterparties[Math.floor(Math.random() * counterparties.length)],
      amount: Math.floor(Math.random() * 20000000) + 500000,
      note: notes[Math.floor(Math.random() * notes.length)],
      createdBy: creators[Math.floor(Math.random() * creators.length)],
    };
  }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

const allEntries = generateCashBookData();

export async function getCashBookEntries(params: QueryParams): Promise<QueryResult<CashBookEntry>> {
  await simulateDelay();
  let filtered = searchFilter(allEntries, params.search, ["code", "counterparty"]);

  if (params.filters?.type && params.filters.type !== "all") {
    filtered = filtered.filter((e) => e.type === params.filters!.type);
  }

  return paginateData(filtered, params.page, params.pageSize);
}

export function getCashBookTypes() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "receipt", label: "Phiếu thu" },
    { value: "payment", label: "Phiếu chi" },
  ];
}

/** Get summary totals for all entries (not just current page) */
export function getCashBookSummary() {
  const totalReceipt = allEntries
    .filter((e) => e.type === "receipt")
    .reduce((sum, e) => sum + e.amount, 0);
  const totalPayment = allEntries
    .filter((e) => e.type === "payment")
    .reduce((sum, e) => sum + e.amount, 0);
  return { totalReceipt, totalPayment };
}
