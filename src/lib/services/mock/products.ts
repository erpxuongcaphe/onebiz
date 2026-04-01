import { Product, ProductDetail, StockMovement, SalesHistory, QueryParams, QueryResult } from "@/lib/types";

const categories = [
  "Cà phê nguyên chất",
  "Cà phê pha trộn",
  "Trà & đồ uống",
  "Vật tư - Bao bì",
  "Phụ kiện",
  "Nguyên liệu",
];

const units = ["Túi", "Hộp", "Cái", "Kg", "Gói", "Chai"];

const productNames = [
  "Xưởng Thượng Hạng - chì nhánh (500gram/túi)",
  "Túi ủ Coldbrew 20×14",
  "Hũ nhôm đựng cà hạt (loại 50ml)",
  "Bình nhựa đựng Cold Brew",
  "Fine Robusta - 500gram/túi",
  "Quả mơ ngâm đường (1000gram/hộp)",
  "Ly thuỷ tinh Americano",
  "Cà phê Arabica Cầu Đất",
  "Cà phê Robusta Đắk Lắk",
  "Bột cacao nguyên chất",
  "Trà sen vàng Premium",
  "Trà ô long đặc biệt",
  "Siro vani 750ml",
  "Siro caramel 750ml",
  "Cốc giấy 12oz (50 cái)",
  "Nắp cốc giấy 12oz (50 cái)",
  "Ống hút giấy (100 cái)",
  "Túi zip đựng cà phê 250g",
  "Máy xay cà phê mini",
  "Phin cà phê inox",
  "Bình giữ nhiệt 500ml",
  "Filter giấy V60 (100 tờ)",
  "Cà phê Honey Process",
  "Cà phê Washed Arabica",
  "Matcha Nhật Bản 100g",
  "Đường nâu gói nhỏ (100 gói)",
  "Sữa đặc Ông Thọ (380g)",
  "Kem sữa không đường 330ml",
  "Hạt macca rang muối 200g",
  "Bánh quy bơ hộp thiếc",
];

function generateProducts(): Product[] {
  return productNames.map((name, i) => {
    const catIndex = i % categories.length;
    const unitIndex = i % units.length;
    const sellPrice = Math.round((Math.random() * 400 + 10) * 1000);
    const costPrice = Math.round(sellPrice * (0.4 + Math.random() * 0.3));
    const stock = Math.round(Math.random() * 200);
    const ordered = Math.floor(Math.random() * 15);
    const daysAgo = Math.floor(Math.random() * 180);
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);

    return {
      id: `prod_${i + 1}`,
      code: `SP${String(i + 600).padStart(6, "0")}`,
      name,
      sellPrice,
      costPrice,
      stock,
      ordered,
      categoryId: `cat_${catIndex}`,
      categoryName: categories[catIndex],
      unit: units[unitIndex],
      createdAt: date.toISOString(),
    };
  });
}

const allProducts = generateProducts();

export async function getProducts(
  params: QueryParams
): Promise<QueryResult<Product>> {
  await new Promise((r) => setTimeout(r, 300));

  let filtered = [...allProducts];

  if (params.search) {
    const q = params.search.toLowerCase();
    filtered = filtered.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q)
    );
  }

  if (params.filters?.category && params.filters.category !== "all") {
    const cats = Array.isArray(params.filters.category)
      ? params.filters.category
      : [params.filters.category];
    filtered = filtered.filter((p) => cats.includes(p.categoryName));
  }

  if (params.filters?.stock) {
    const stockFilter = params.filters.stock as string;
    if (stockFilter === "in_stock") {
      filtered = filtered.filter((p) => p.stock > 0);
    } else if (stockFilter === "out_of_stock") {
      filtered = filtered.filter((p) => p.stock === 0);
    } else if (stockFilter === "low_stock") {
      filtered = filtered.filter((p) => p.stock > 0 && p.stock <= 5);
    }
  }

  const total = filtered.length;
  const start = params.page * params.pageSize;
  const data = filtered.slice(start, start + params.pageSize);

  return { data, total };
}

export function getProductCategories() {
  return categories.map((name, i) => ({
    label: name,
    value: name,
    count: allProducts.filter((p) => p.categoryName === name).length,
  }));
}

// === Product Detail ===

export async function getProductById(id: string): Promise<ProductDetail | null> {
  await new Promise((r) => setTimeout(r, 200));
  const product = allProducts.find((p) => p.id === id);
  if (!product) return null;

  return {
    ...product,
    barcode: `899${product.code.replace("SP", "")}00${Math.floor(Math.random() * 9)}`,
    weight: Math.round(Math.random() * 2000 + 50),
    description: `Sản phẩm ${product.name} chất lượng cao, phù hợp cho quán cà phê và người dùng cá nhân.`,
    minStock: 5,
    maxStock: 500,
    position: `Kệ ${String.fromCharCode(65 + Math.floor(Math.random() * 6))}-${Math.floor(Math.random() * 10) + 1}`,
    allowSale: true,
    properties: [
      { name: "Xuất xứ", value: "Việt Nam" },
      { name: "Hạn sử dụng", value: "12 tháng" },
    ],
    images: [],
    priceBooks: [
      { name: "Giá bán lẻ", price: product.sellPrice },
      { name: "Giá bán buôn", price: Math.round(product.sellPrice * 0.85) },
      { name: "Giá VIP", price: Math.round(product.sellPrice * 0.9) },
    ],
  };
}

// === Stock Movements ===

const movementTypes: { type: StockMovement["type"]; name: string }[] = [
  { type: "import", name: "Nhập hàng" },
  { type: "export", name: "Xuất hàng" },
  { type: "adjustment", name: "Kiểm kho" },
  { type: "transfer", name: "Chuyển kho" },
  { type: "return", name: "Trả hàng nhập" },
];

const staffNames = ["Nguyễn Văn A", "Trần Thị B", "Lê Văn C", "Phạm Thị D"];

const supplierNames = [
  "Công ty TNHH Cà Phê Sài Gòn",
  "NCC Nguyên liệu Đắk Lắk",
  "Công ty Bao Bì Xanh",
  "NCC Thiết bị HCM",
];

export async function getStockMovements(
  productId: string,
  params: QueryParams
): Promise<QueryResult<StockMovement>> {
  await new Promise((r) => setTimeout(r, 300));

  const seed = productId.charCodeAt(productId.length - 1);
  const count = 15 + (seed % 10);
  const movements: StockMovement[] = [];

  for (let i = 0; i < count; i++) {
    const mt = movementTypes[(seed + i) % movementTypes.length];
    const qty = Math.floor(Math.random() * 50) + 1;
    const cost = Math.round((Math.random() * 200 + 20) * 1000);
    const daysAgo = Math.floor(Math.random() * 90);
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);

    movements.push({
      id: `sm_${productId}_${i}`,
      code: mt.type === "import" ? `PN${String(1000 + i).padStart(6, "0")}` :
            mt.type === "export" ? `PX${String(2000 + i).padStart(6, "0")}` :
            mt.type === "return" ? `TH${String(3000 + i).padStart(6, "0")}` :
            `KK${String(4000 + i).padStart(6, "0")}`,
      type: mt.type,
      typeName: mt.name,
      quantity: mt.type === "export" || mt.type === "return" ? -qty : qty,
      costPrice: cost,
      totalAmount: qty * cost,
      date: date.toISOString(),
      createdBy: staffNames[(seed + i) % staffNames.length],
      supplierName: mt.type === "import" ? supplierNames[(seed + i) % supplierNames.length] : undefined,
      note: i % 3 === 0 ? `Ghi chú phiếu #${i + 1}` : undefined,
    });
  }

  movements.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const total = movements.length;
  const start = params.page * params.pageSize;
  const data = movements.slice(start, start + params.pageSize);

  return { data, total };
}

// === Sales History ===

const customerNames = [
  "Nguyễn Minh Tuấn", "Trần Thị Hoa", "Lê Văn Đức", "Phạm Mai Lan",
  "Hoàng Anh Dũng", "Vũ Thị Ngọc", "Đỗ Quang Huy", "Bùi Thanh Tâm",
  "Khách lẻ", "Khách lẻ", "Khách lẻ",
];

const saleStatuses: { status: SalesHistory["status"]; name: string }[] = [
  { status: "completed", name: "Hoàn thành" },
  { status: "cancelled", name: "Đã hủy" },
  { status: "returned", name: "Đã trả" },
];

export async function getSalesHistory(
  productId: string,
  params: QueryParams
): Promise<QueryResult<SalesHistory>> {
  await new Promise((r) => setTimeout(r, 300));

  const seed = productId.charCodeAt(productId.length - 1);
  const count = 20 + (seed % 15);
  const history: SalesHistory[] = [];

  for (let i = 0; i < count; i++) {
    const qty = Math.floor(Math.random() * 10) + 1;
    const price = Math.round((Math.random() * 300 + 30) * 1000);
    const discount = i % 4 === 0 ? Math.round(price * qty * 0.05) : 0;
    const statusIdx = i % 10 === 0 ? 1 : i % 15 === 0 ? 2 : 0;
    const st = saleStatuses[statusIdx];
    const daysAgo = Math.floor(Math.random() * 60);
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);

    history.push({
      id: `sh_${productId}_${i}`,
      invoiceCode: `HD${String(5000 + seed * 10 + i).padStart(6, "0")}`,
      date: date.toISOString(),
      customerName: customerNames[(seed + i) % customerNames.length],
      quantity: qty,
      sellPrice: price,
      discount,
      totalAmount: price * qty - discount,
      status: st.status,
      statusName: st.name,
      createdBy: staffNames[(seed + i) % staffNames.length],
    });
  }

  history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const total = history.length;
  const start = params.page * params.pageSize;
  const data = history.slice(start, start + params.pageSize);

  return { data, total };
}
