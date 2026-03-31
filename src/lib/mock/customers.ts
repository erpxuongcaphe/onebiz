import { Customer, QueryParams, QueryResult } from "@/lib/types";

const customerData: Omit<Customer, "id" | "code" | "createdAt">[] = [
  { name: "Nguyễn Minh Tuấn", phone: "0901234567", email: "tuan.nm@gmail.com", address: "123 Nguyễn Huệ, Q.1, TP.HCM", currentDebt: 500000, totalSales: 15000000, totalSalesMinusReturns: 14500000, type: "individual", gender: "male" },
  { name: "Trần Thị Hoa", phone: "0912345678", email: "hoa.tt@gmail.com", address: "45 Lê Lợi, Q.1, TP.HCM", currentDebt: 0, totalSales: 8200000, totalSalesMinusReturns: 8200000, type: "individual", gender: "female" },
  { name: "Lê Văn Đức", phone: "0923456789", address: "78 Trần Hưng Đạo, Q.5, TP.HCM", currentDebt: 1200000, totalSales: 25000000, totalSalesMinusReturns: 23800000, type: "individual", gender: "male" },
  { name: "Phạm Mai Lan", phone: "0934567890", email: "lan.pm@company.vn", address: "90 Điện Biên Phủ, Q.Bình Thạnh", currentDebt: 0, totalSales: 5600000, totalSalesMinusReturns: 5600000, type: "individual", gender: "female" },
  { name: "Công ty TNHH ABC Coffee", phone: "0945678901", email: "info@abccoffee.vn", address: "200 Cách Mạng Tháng 8, Q.3, TP.HCM", currentDebt: 8500000, totalSales: 120000000, totalSalesMinusReturns: 115000000, type: "company", groupId: "grp_1", groupName: "Đại lý" },
  { name: "Hoàng Anh Dũng", phone: "0956789012", address: "15 Pasteur, Q.1, TP.HCM", currentDebt: 300000, totalSales: 9800000, totalSalesMinusReturns: 9500000, type: "individual", gender: "male" },
  { name: "Vũ Thị Ngọc", phone: "0967890123", email: "ngoc.vt@gmail.com", address: "34 Hai Bà Trưng, Q.1, TP.HCM", currentDebt: 0, totalSales: 3200000, totalSalesMinusReturns: 3200000, type: "individual", gender: "female" },
  { name: "Đỗ Quang Huy", phone: "0978901234", address: "56 Nguyễn Đình Chiểu, Q.3, TP.HCM", currentDebt: 750000, totalSales: 18500000, totalSalesMinusReturns: 17750000, type: "individual", gender: "male" },
  { name: "Quán Cà Phê Bùi Thanh Tâm", phone: "0989012345", email: "tam@quancaphe.vn", address: "89 Phan Xích Long, Q.Phú Nhuận", currentDebt: 3200000, totalSales: 85000000, totalSalesMinusReturns: 82000000, type: "company", groupId: "grp_1", groupName: "Đại lý" },
  { name: "Chuỗi The Coffee House clone", phone: "0990123456", email: "order@tch.vn", address: "100 Nguyễn Văn Trỗi, Q.Phú Nhuận", currentDebt: 15000000, totalSales: 350000000, totalSalesMinusReturns: 340000000, type: "company", groupId: "grp_2", groupName: "VIP" },
  { name: "Nguyễn Thị Bích", phone: "0911223344", address: "22 Lý Tự Trọng, Q.1, TP.HCM", currentDebt: 0, totalSales: 2100000, totalSalesMinusReturns: 2100000, type: "individual", gender: "female" },
  { name: "Trần Đại Nam", phone: "0922334455", email: "nam.td@gmail.com", address: "67 Võ Văn Tần, Q.3, TP.HCM", currentDebt: 0, totalSales: 4500000, totalSalesMinusReturns: 4500000, type: "individual", gender: "male" },
  { name: "Công ty Phân Phối Miền Nam", phone: "0933445566", email: "info@ppnn.vn", address: "150 Nguyễn Văn Linh, Q.7, TP.HCM", currentDebt: 22000000, totalSales: 500000000, totalSalesMinusReturns: 480000000, type: "company", groupId: "grp_2", groupName: "VIP" },
  { name: "Lê Hoàng Phúc", phone: "0944556677", address: "88 Trường Chinh, Q.Tân Bình", currentDebt: 0, totalSales: 1800000, totalSalesMinusReturns: 1800000, type: "individual", gender: "male" },
  { name: "Phạm Ngọc Anh", phone: "0955667788", email: "anh.pn@outlook.com", address: "12 Bùi Viện, Q.1, TP.HCM", currentDebt: 200000, totalSales: 6700000, totalSalesMinusReturns: 6500000, type: "individual", gender: "female" },
];

function generateCustomers(): Customer[] {
  return customerData.map((c, i) => {
    const daysAgo = Math.floor(Math.random() * 300) + 10;
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return {
      ...c,
      id: `cus_${i + 1}`,
      code: `KH${String(i + 1).padStart(5, "0")}`,
      createdAt: date.toISOString(),
    };
  });
}

const allCustomers = generateCustomers();

export async function getCustomers(
  params: QueryParams
): Promise<QueryResult<Customer>> {
  await new Promise((r) => setTimeout(r, 300));

  let filtered = [...allCustomers];

  if (params.search) {
    const q = params.search.toLowerCase();
    filtered = filtered.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.phone.includes(q)
    );
  }

  if (params.filters?.type && params.filters.type !== "all") {
    filtered = filtered.filter((c) => c.type === params.filters!.type);
  }

  if (params.filters?.group) {
    const groups = Array.isArray(params.filters.group) ? params.filters.group : [params.filters.group];
    filtered = filtered.filter((c) => c.groupName && groups.includes(c.groupName));
  }

  if (params.filters?.debt) {
    const debtFilter = params.filters.debt as string;
    if (debtFilter === "has_debt") filtered = filtered.filter((c) => c.currentDebt > 0);
    else if (debtFilter === "no_debt") filtered = filtered.filter((c) => c.currentDebt === 0);
  }

  const total = filtered.length;
  const start = params.page * params.pageSize;
  const data = filtered.slice(start, start + params.pageSize);

  return { data, total };
}

export function getCustomerGroups() {
  const groups = [...new Set(allCustomers.map((c) => c.groupName).filter(Boolean))] as string[];
  return groups.map((g) => ({
    label: g,
    value: g,
    count: allCustomers.filter((c) => c.groupName === g).length,
  }));
}

export async function getCustomerById(id: string): Promise<Customer | null> {
  await new Promise((r) => setTimeout(r, 200));
  return allCustomers.find((c) => c.id === id) ?? null;
}
