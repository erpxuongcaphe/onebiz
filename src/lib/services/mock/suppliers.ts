import { Supplier, QueryParams, QueryResult } from "@/lib/types";

const supplierData: Omit<Supplier, "id" | "code" | "createdAt">[] = [
  { name: "Công ty TNHH Cà Phê Sài Gòn", phone: "0901234567", email: "info@caphesaigon.vn", address: "123 Nguyễn Huệ, Q.1, TP.HCM", currentDebt: 15000000, totalPurchases: 250000000 },
  { name: "NCC Nguyên liệu Đắk Lắk", phone: "0912345678", email: "daklak@ncc.vn", address: "45 Trần Phú, TP. Buôn Ma Thuột", currentDebt: 8500000, totalPurchases: 180000000 },
  { name: "Công ty Bao Bì Xanh", phone: "0923456789", email: "sales@baobixanh.vn", address: "789 Lý Thường Kiệt, Q.Tân Bình, TP.HCM", currentDebt: 0, totalPurchases: 95000000 },
  { name: "NCC Thiết bị HCM", phone: "0934567890", email: "contact@tbhcm.vn", address: "56 Cách Mạng Tháng 8, Q.3, TP.HCM", currentDebt: 3200000, totalPurchases: 120000000 },
  { name: "Đại lý Trà Thái Nguyên", phone: "0945678901", email: "trathainguyen@gmail.com", address: "12 Hoàng Văn Thụ, TP. Thái Nguyên", currentDebt: 5000000, totalPurchases: 75000000 },
  { name: "Công ty CP Sữa Tươi Việt", phone: "0956789012", email: "info@suatuoiviet.vn", address: "234 Điện Biên Phủ, Q.Bình Thạnh, TP.HCM", currentDebt: 12000000, totalPurchases: 320000000 },
  { name: "NCC Đường & Gia vị Miền Tây", phone: "0967890123", email: "duong@mientay.vn", address: "78 Trần Hưng Đạo, TP. Cần Thơ", currentDebt: 0, totalPurchases: 45000000 },
  { name: "Công ty Giấy & Nhựa Sạch", phone: "0978901234", email: "clean@giaynhua.vn", address: "90 Nguyễn Văn Linh, Q.7, TP.HCM", currentDebt: 7800000, totalPurchases: 88000000 },
  { name: "NCC Máy móc Cà phê Pro", phone: "0989012345", email: "pro@maycaphe.vn", address: "15 Phạm Văn Đồng, Q.Thủ Đức, TP.HCM", currentDebt: 25000000, totalPurchases: 450000000 },
  { name: "Trang trại Cacao Bến Tre", phone: "0990123456", email: "cacao@bentre.vn", address: "33 Đồng Khởi, TP. Bến Tre", currentDebt: 1500000, totalPurchases: 62000000 },
  { name: "Công ty Hương liệu Á Châu", phone: "0911223344", email: "asia@huonglieu.vn", address: "67 Lê Lợi, Q.1, TP.HCM", currentDebt: 0, totalPurchases: 38000000 },
  { name: "NCC Matcha Nhật Bản Import", phone: "0922334455", email: "matcha@jpimport.vn", address: "200 Hai Bà Trưng, Q.1, TP.HCM", currentDebt: 18000000, totalPurchases: 210000000 },
];

function generateSuppliers(): Supplier[] {
  return supplierData.map((s, i) => {
    const daysAgo = Math.floor(Math.random() * 365) + 30;
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return {
      ...s,
      id: `sup_${i + 1}`,
      code: `NCC${String(i + 1).padStart(5, "0")}`,
      createdAt: date.toISOString(),
    };
  });
}

const allSuppliers = generateSuppliers();

export async function getSuppliers(
  params: QueryParams
): Promise<QueryResult<Supplier>> {
  await new Promise((r) => setTimeout(r, 300));

  let filtered = [...allSuppliers];

  if (params.search) {
    const q = params.search.toLowerCase();
    filtered = filtered.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        s.phone.includes(q)
    );
  }

  if (params.filters?.debt) {
    const debtFilter = params.filters.debt as string;
    if (debtFilter === "has_debt") filtered = filtered.filter((s) => s.currentDebt > 0);
    else if (debtFilter === "no_debt") filtered = filtered.filter((s) => s.currentDebt === 0);
  }

  const total = filtered.length;
  const start = params.page * params.pageSize;
  const data = filtered.slice(start, start + params.pageSize);

  return { data, total };
}

export async function getSupplierById(id: string): Promise<Supplier | null> {
  await new Promise((r) => setTimeout(r, 200));
  return allSuppliers.find((s) => s.id === id) ?? null;
}
