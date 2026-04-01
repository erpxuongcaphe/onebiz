import { PurchaseOrder, QueryParams, QueryResult } from "@/lib/types";

const supplierNames = [
  "Công ty TNHH Cà Phê Sài Gòn",
  "NCC Nguyên liệu Đắk Lắk",
  "Công ty Bao Bì Xanh",
  "NCC Thiết bị HCM",
  "Đại lý Trà Thái Nguyên",
  "Công ty CP Sữa Tươi Việt",
];

const staffNames = ["Nguyễn Văn A", "Trần Thị B", "Lê Văn C", "Phạm Thị D"];

function generatePurchaseOrders(): PurchaseOrder[] {
  const orders: PurchaseOrder[] = [];
  for (let i = 0; i < 35; i++) {
    const daysAgo = Math.floor(Math.random() * 90);
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const statusArr: PurchaseOrder["status"][] = ["draft", "imported", "cancelled"];
    const status = statusArr[i % 7 === 0 ? 2 : i % 3 === 0 ? 0 : 1];

    orders.push({
      id: `po_${i + 1}`,
      code: `PN${String(i + 1000).padStart(6, "0")}`,
      orderCode: i % 2 === 0 ? `DH${String(i + 500).padStart(6, "0")}` : undefined,
      date: date.toISOString(),
      supplierId: `sup_${(i % 6) + 1}`,
      supplierCode: `NCC${String((i % 6) + 1).padStart(5, "0")}`,
      supplierName: supplierNames[i % 6],
      amountOwed: Math.round((Math.random() * 50 + 5) * 1000000),
      status,
      createdBy: staffNames[i % 4],
      importedBy: status === "imported" ? staffNames[(i + 1) % 4] : undefined,
    });
  }
  return orders;
}

const allPurchaseOrders = generatePurchaseOrders();

export async function getPurchaseOrders(
  params: QueryParams
): Promise<QueryResult<PurchaseOrder>> {
  await new Promise((r) => setTimeout(r, 300));

  let filtered = [...allPurchaseOrders];

  if (params.search) {
    const q = params.search.toLowerCase();
    filtered = filtered.filter(
      (o) =>
        o.code.toLowerCase().includes(q) ||
        o.supplierName.toLowerCase().includes(q)
    );
  }

  if (params.filters?.status && params.filters.status !== "all") {
    filtered = filtered.filter((o) => o.status === params.filters!.status);
  }

  if (params.filters?.supplier && params.filters.supplier !== "all") {
    filtered = filtered.filter((o) => o.supplierName === params.filters!.supplier);
  }

  filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const total = filtered.length;
  const start = params.page * params.pageSize;
  const data = filtered.slice(start, start + params.pageSize);

  return { data, total };
}

export function getPurchaseOrderStatuses() {
  return [
    { label: "Phiếu tạm", value: "draft", count: allPurchaseOrders.filter((o) => o.status === "draft").length },
    { label: "Đã nhập hàng", value: "imported", count: allPurchaseOrders.filter((o) => o.status === "imported").length },
    { label: "Đã hủy", value: "cancelled", count: allPurchaseOrders.filter((o) => o.status === "cancelled").length },
  ];
}
