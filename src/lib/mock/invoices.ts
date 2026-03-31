import { Invoice, QueryParams, QueryResult } from "@/lib/types";

const customerNames = [
  "Nguyễn Minh Tuấn", "Trần Thị Hoa", "Lê Văn Đức", "Phạm Mai Lan",
  "Hoàng Anh Dũng", "Vũ Thị Ngọc", "Đỗ Quang Huy", "Bùi Thanh Tâm",
  "Khách lẻ", "Khách lẻ", "Khách lẻ", "Khách lẻ",
];

const staffNames = ["Nguyễn Văn A", "Trần Thị B", "Lê Văn C", "Phạm Thị D"];

function generateInvoices(): Invoice[] {
  const invoices: Invoice[] = [];
  for (let i = 0; i < 50; i++) {
    const daysAgo = Math.floor(Math.random() * 60);
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const statusArr: Invoice["status"][] = ["completed", "processing", "cancelled", "delivery_failed"];
    const status = statusArr[i % 12 === 0 ? 2 : i % 15 === 0 ? 3 : i % 5 === 0 ? 1 : 0];
    const hasDelivery = i % 3 === 0;
    const deliveryStatusArr: NonNullable<Invoice["deliveryStatus"]>[] = ["pending", "shipping", "delivered", "failed"];

    invoices.push({
      id: `inv_${i + 1}`,
      code: `HD${String(i + 5000).padStart(6, "0")}`,
      date: date.toISOString(),
      returnCode: i % 8 === 0 ? `TH${String(i + 100).padStart(6, "0")}` : undefined,
      customerId: `cus_${(i % 12) + 1}`,
      customerCode: `KH${String((i % 12) + 1).padStart(5, "0")}`,
      customerName: customerNames[i % 12],
      totalAmount: Math.round((Math.random() * 5 + 0.5) * 1000000),
      discount: i % 4 === 0 ? Math.round(Math.random() * 100000) : 0,
      status,
      deliveryType: hasDelivery ? "delivery" : "no_delivery",
      deliveryStatus: hasDelivery ? deliveryStatusArr[i % 4] : undefined,
      createdBy: staffNames[i % 4],
    });
  }
  return invoices;
}

const allInvoices = generateInvoices();

export async function getInvoices(
  params: QueryParams
): Promise<QueryResult<Invoice>> {
  await new Promise((r) => setTimeout(r, 300));

  let filtered = [...allInvoices];

  if (params.search) {
    const q = params.search.toLowerCase();
    filtered = filtered.filter(
      (inv) =>
        inv.code.toLowerCase().includes(q) ||
        inv.customerName.toLowerCase().includes(q)
    );
  }

  if (params.filters?.status && params.filters.status !== "all") {
    filtered = filtered.filter((inv) => inv.status === params.filters!.status);
  }

  filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const total = filtered.length;
  const start = params.page * params.pageSize;
  const data = filtered.slice(start, start + params.pageSize);

  return { data, total };
}

export function getInvoiceStatuses() {
  return [
    { label: "Hoàn thành", value: "completed", count: allInvoices.filter((i) => i.status === "completed").length },
    { label: "Đang xử lý", value: "processing", count: allInvoices.filter((i) => i.status === "processing").length },
    { label: "Đã hủy", value: "cancelled", count: allInvoices.filter((i) => i.status === "cancelled").length },
    { label: "Giao thất bại", value: "delivery_failed", count: allInvoices.filter((i) => i.status === "delivery_failed").length },
  ];
}
