import { PERMISSIONS } from "@/lib/permissions/constants";

export type ReportCategoryId =
  | "executive"
  | "sales"
  | "customers"
  | "inventory"
  | "finance"
  | "operations";

export interface ReportCategory {
  id: ReportCategoryId;
  title: string;
  description: string;
  icon: string;
}

export interface ReportCatalogItem {
  href: string;
  title: string;
  shortTitle: string;
  description: string;
  category: ReportCategoryId;
  icon: string;
  keywords: string[];
  permissions: string[];
  permissionMode?: "any" | "all";
}

export const REPORT_CENTER_PATH = "/phan-tich/trung-tam";

export const REPORT_CATEGORIES: ReportCategory[] = [
  {
    id: "executive",
    title: "Điều hành",
    description: "Tổng quan nhanh, cuối ngày, cảnh báo và đối chiếu vận hành.",
    icon: "space_dashboard",
  },
  {
    id: "sales",
    title: "Bán hàng & doanh thu",
    description: "Doanh thu, đơn hàng, kênh bán, khuyến mãi và hiệu suất bán.",
    icon: "trending_up",
  },
  {
    id: "customers",
    title: "Khách hàng",
    description: "Hành vi mua, sản phẩm đã mua, quay lại và phân khúc khách.",
    icon: "groups",
  },
  {
    id: "inventory",
    title: "Hàng hóa & tồn kho",
    description: "Xuất nhập tồn, kiểm kê, lô hàng, tiêu hao và giá vốn.",
    icon: "inventory_2",
  },
  {
    id: "finance",
    title: "Tài chính",
    description: "Lợi nhuận, dòng tiền, thuế, công nợ và chi phí nền tảng.",
    icon: "account_balance",
  },
  {
    id: "operations",
    title: "Vận hành & đối tác",
    description: "F&B, thời gian phục vụ, nhân viên và nhà cung cấp.",
    icon: "manufacturing",
  },
];

const DASHBOARD_PERMISSIONS = [
  PERMISSIONS.REPORTS_DASHBOARD,
  PERMISSIONS.REPORTS_ANALYTICS,
];
const ANALYTICS_PERMISSIONS = [PERMISSIONS.REPORTS_ANALYTICS];
const FNB_PERMISSIONS = [
  PERMISSIONS.REPORTS_FNB,
  PERMISSIONS.REPORTS_ANALYTICS,
];
const PROFIT_PERMISSIONS = [
  PERMISSIONS.REPORTS_ANALYTICS,
  PERMISSIONS.REPORTS_VIEW_PROFIT,
];

export const REPORT_CATALOG: ReportCatalogItem[] = [
  {
    href: "/phan-tich",
    title: "Tổng quan kinh doanh",
    shortTitle: "Tổng quan",
    description: "Các chỉ số quan trọng về doanh thu, đơn hàng và lợi nhuận.",
    category: "executive",
    icon: "bar_chart",
    keywords: ["dashboard", "kpi", "doanh thu", "lợi nhuận", "tổng hợp"],
    permissions: DASHBOARD_PERMISSIONS,
  },
  {
    href: "/phan-tich/cuoi-ngay",
    title: "Báo cáo cuối ngày",
    shortTitle: "Cuối ngày",
    description: "Kiểm tra nhanh kết quả bán hàng và thu chi cuối ngày.",
    category: "executive",
    icon: "event_available",
    keywords: ["eod", "chốt ngày", "doanh thu ngày", "thu chi"],
    permissions: DASHBOARD_PERMISSIONS,
  },
  {
    href: "/phan-tich/tong-hop-kenh",
    title: "Tổng hợp theo kênh",
    shortTitle: "Tổng hợp kênh",
    description: "So sánh kết quả giữa cửa hàng, POS và các kênh bán.",
    category: "executive",
    icon: "donut_large",
    keywords: ["đa kênh", "omnichannel", "cửa hàng", "pos"],
    permissions: DASHBOARD_PERMISSIONS,
  },
  {
    href: "/phan-tich/canh-bao",
    title: "Cảnh báo điều hành",
    shortTitle: "Cảnh báo",
    description: "Các bất thường cần ưu tiên kiểm tra trong vận hành.",
    category: "executive",
    icon: "warning",
    keywords: ["bất thường", "rủi ro", "cần xử lý", "alert"],
    permissions: DASHBOARD_PERMISSIONS,
  },
  {
    href: "/phan-tich/doi-chieu-ca",
    title: "Đối chiếu ca làm việc",
    shortTitle: "Đối chiếu ca",
    description: "Theo dõi ca bán hàng và chênh lệch cần đối chiếu.",
    category: "executive",
    icon: "fact_check",
    keywords: ["ca bán hàng", "chốt ca", "lệch ca", "đối soát"],
    permissions: DASHBOARD_PERMISSIONS,
  },
  {
    href: "/phan-tich/ban-hang",
    title: "Doanh thu bán hàng",
    shortTitle: "Bán hàng",
    description: "Phân tích doanh thu, số đơn và giá trị đơn theo thời gian.",
    category: "sales",
    icon: "trending_up",
    keywords: ["sales", "doanh số", "hóa đơn", "aov"],
    permissions: ANALYTICS_PERMISSIONS,
  },
  {
    href: "/phan-tich/dat-hang",
    title: "Đặt hàng & xử lý",
    shortTitle: "Đặt hàng",
    description: "Theo dõi đơn đặt, tỷ lệ chuyển đổi và tiến độ xử lý.",
    category: "sales",
    icon: "assignment",
    keywords: ["đơn đặt hàng", "order", "chuyển đổi", "xử lý đơn"],
    permissions: ANALYTICS_PERMISSIONS,
  },
  {
    href: "/phan-tich/kenh-ban",
    title: "Hiệu quả theo kênh bán",
    shortTitle: "Kênh bán",
    description: "So sánh doanh thu và đơn hàng giữa các kênh bán.",
    category: "sales",
    icon: "storefront",
    keywords: ["channel", "online", "offline", "pos", "sàn"],
    permissions: ANALYTICS_PERMISSIONS,
  },
  {
    href: "/phan-tich/khuyen-mai",
    title: "Hiệu quả khuyến mãi",
    shortTitle: "Khuyến mãi",
    description: "Đánh giá chương trình, mức giảm và doanh thu khuyến mãi.",
    category: "sales",
    icon: "redeem",
    keywords: ["promotion", "voucher", "mã giảm giá", "chiết khấu"],
    permissions: ANALYTICS_PERMISSIONS,
  },
  {
    href: "/phan-tich/tra-hang",
    title: "Trả hàng chi tiết",
    shortTitle: "Trả hàng",
    description: "Theo dõi số lượng, giá trị và nguyên nhân trả hàng.",
    category: "sales",
    icon: "assignment_return",
    keywords: ["refund", "hoàn hàng", "đổi trả", "giảm doanh thu"],
    permissions: ANALYTICS_PERMISSIONS,
  },
  {
    href: "/phan-tich/platform-commission",
    title: "Phí nền tảng giao hàng",
    shortTitle: "Phí nền tảng",
    description: "Tổng hợp phí và tỷ lệ chi phí theo nền tảng giao hàng.",
    category: "sales",
    icon: "percent",
    keywords: ["delivery", "commission", "grab", "shopee", "phí sàn"],
    permissions: ANALYTICS_PERMISSIONS,
  },
  {
    href: "/phan-tich/khach-hang",
    title: "Doanh thu theo khách hàng",
    shortTitle: "Khách hàng",
    description: "Xếp hạng và phân tích doanh thu của từng khách hàng.",
    category: "customers",
    icon: "person",
    keywords: ["customer", "top khách", "doanh thu khách", "người mua"],
    permissions: ANALYTICS_PERMISSIONS,
  },
  {
    href: "/phan-tich/khach-san-pham",
    title: "Sản phẩm theo khách hàng",
    shortTitle: "Khách × Sản phẩm",
    description: "Xem từng khách đã mua sản phẩm nào, số lượng và doanh thu.",
    category: "customers",
    icon: "diversity_3",
    keywords: ["khách mua gì", "sản phẩm theo khách", "customer product", "pivot khách hàng"],
    permissions: ANALYTICS_PERMISSIONS,
  },
  {
    href: "/phan-tich/customer-cohort",
    title: "Khách hàng quay lại",
    shortTitle: "Khách quay lại",
    description: "Theo dõi tỷ lệ quay lại và duy trì khách theo nhóm thời gian.",
    category: "customers",
    icon: "repeat",
    keywords: ["cohort", "retention", "tái mua", "khách cũ"],
    permissions: ANALYTICS_PERMISSIONS,
  },
  {
    href: "/phan-tich/rfm",
    title: "Phân khúc khách hàng RFM",
    shortTitle: "Phân khúc RFM",
    description: "Phân nhóm khách theo lần mua gần nhất, tần suất và giá trị.",
    category: "customers",
    icon: "stars",
    keywords: ["recency", "frequency", "monetary", "vip", "phân nhóm khách"],
    permissions: ANALYTICS_PERMISSIONS,
  },
  {
    href: "/phan-tich/xuat-nhap-ton",
    title: "Xuất - Nhập - Tồn",
    shortTitle: "Xuất nhập tồn",
    description: "Biến động nhập, xuất và tồn cuối kỳ của hàng hóa.",
    category: "inventory",
    icon: "inventory_2",
    keywords: ["xnt", "stock movement", "tồn đầu", "tồn cuối"],
    permissions: ANALYTICS_PERMISSIONS,
  },
  {
    href: "/phan-tich/hang-hoa",
    title: "Phân tích hàng hóa",
    shortTitle: "Hàng hóa",
    description: "Hiệu quả bán, số lượng và doanh thu theo sản phẩm.",
    category: "inventory",
    icon: "analytics",
    keywords: ["sản phẩm", "mặt hàng", "sku", "doanh thu sản phẩm"],
    permissions: ANALYTICS_PERMISSIONS,
  },
  {
    href: "/phan-tich/abc-analysis",
    title: "Phân loại sản phẩm ABC",
    shortTitle: "Phân loại ABC",
    description: "Phân nhóm sản phẩm theo mức đóng góp doanh thu.",
    category: "inventory",
    icon: "leaderboard",
    keywords: ["abc", "pareto", "80/20", "xếp hạng sản phẩm"],
    permissions: ANALYTICS_PERMISSIONS,
  },
  {
    href: "/phan-tich/lot-traceability",
    title: "Truy xuất nguồn gốc theo lô",
    shortTitle: "Truy xuất lô",
    description: "Theo dõi nguồn nhập, sử dụng và lịch sử của từng lô hàng.",
    category: "inventory",
    icon: "qr_code",
    keywords: ["lot", "batch", "nguồn gốc", "lô sản xuất"],
    permissions: ANALYTICS_PERMISSIONS,
  },
  {
    href: "/phan-tich/kiem-ke",
    title: "Báo cáo kiểm kê",
    shortTitle: "Kiểm kê",
    description: "Tổng hợp các phiên kiểm kê và kết quả điều chỉnh kho.",
    category: "inventory",
    icon: "fact_check",
    keywords: ["kiểm kho", "stocktake", "điều chỉnh tồn"],
    permissions: ANALYTICS_PERMISSIONS,
  },
  {
    href: "/phan-tich/chenh-lech-kiem-ke",
    title: "Chênh lệch kiểm kê",
    shortTitle: "Chênh lệch kiểm kê",
    description: "Phân tích chênh lệch sổ sách và tồn thực tế.",
    category: "inventory",
    icon: "balance",
    keywords: ["lệch kho", "thừa thiếu", "kiểm kho", "variance"],
    permissions: ANALYTICS_PERMISSIONS,
  },
  {
    href: "/phan-tich/aging",
    title: "Tuổi tồn kho & hàng chậm bán",
    shortTitle: "Aging tồn kho",
    description: "Nhận diện hàng tồn lâu, chậm luân chuyển và dead-stock.",
    category: "inventory",
    icon: "hourglass_top",
    keywords: ["aging", "dead stock", "chậm bán", "tuổi tồn"],
    permissions: ANALYTICS_PERMISSIONS,
  },
  {
    href: "/phan-tich/ton-that",
    title: "Tổn thất tồn kho",
    shortTitle: "Tổn thất",
    description: "Theo dõi hủy, hao hụt và các giá trị thất thoát hàng hóa.",
    category: "inventory",
    icon: "delete_sweep",
    keywords: ["waste", "hao hụt", "xuất hủy", "thất thoát"],
    permissions: ANALYTICS_PERMISSIONS,
  },
  {
    href: "/phan-tich/tieu-hao-nvl",
    title: "Tiêu hao nguyên vật liệu",
    shortTitle: "Tiêu hao NVL",
    description: "So sánh mức sử dụng nguyên vật liệu theo chi nhánh.",
    category: "inventory",
    icon: "science",
    keywords: ["nvl", "nguyên liệu", "consumption", "định mức"],
    permissions: ANALYTICS_PERMISSIONS,
  },
  {
    href: "/phan-tich/cogs-theo-bom",
    title: "Giá vốn thực tế theo BOM",
    shortTitle: "COGS theo BOM",
    description: "Phân tích giá vốn thực tế dựa trên công thức sản xuất.",
    category: "inventory",
    icon: "receipt_long",
    keywords: ["cogs", "bom", "giá vốn", "công thức"],
    permissions: PROFIT_PERMISSIONS,
    permissionMode: "all",
  },
  {
    href: "/phan-tich/tai-chinh",
    title: "Phân tích tài chính",
    shortTitle: "Tài chính",
    description: "Các tỷ lệ và chỉ số tài chính phục vụ quản trị.",
    category: "finance",
    icon: "account_balance_wallet",
    keywords: ["financial", "margin", "tỷ suất", "quản trị"],
    permissions: PROFIT_PERMISSIONS,
    permissionMode: "all",
  },
  {
    href: "/phan-tich/bao-cao-tai-chinh",
    title: "Báo cáo kết quả vận hành",
    shortTitle: "Kết quả vận hành",
    description: "Doanh thu, giá vốn, chi phí và kết quả vận hành theo kỳ đã chọn.",
    category: "finance",
    icon: "description",
    keywords: ["p&l", "lãi lỗ", "profit loss", "kết quả kinh doanh"],
    permissions: PROFIT_PERMISSIONS,
    permissionMode: "all",
  },
  {
    href: "/phan-tich/luong-tien",
    title: "Lưu chuyển tiền tệ",
    shortTitle: "Luồng tiền",
    description: "Theo dõi dòng tiền vào, ra và số dư theo thời gian.",
    category: "finance",
    icon: "swap_horiz",
    keywords: ["cash flow", "tiền vào", "tiền ra", "số dư"],
    permissions: ANALYTICS_PERMISSIONS,
  },
  {
    href: "/phan-tich/vat",
    title: "VAT đầu vào / đầu ra",
    shortTitle: "Báo cáo VAT",
    description: "Tổng hợp thuế giá trị gia tăng đầu vào và đầu ra.",
    category: "finance",
    icon: "request_quote",
    keywords: ["thuế", "gtgt", "hóa đơn đầu vào", "hóa đơn đầu ra"],
    permissions: ANALYTICS_PERMISSIONS,
  },
  {
    href: "/phan-tich/cong-no-aging",
    title: "Tuổi nợ phải thu",
    shortTitle: "Công nợ aging",
    description: "Phân nhóm công nợ khách hàng theo thời gian quá hạn.",
    category: "finance",
    icon: "credit_card",
    keywords: ["debt aging", "phải thu", "quá hạn", "công nợ khách"],
    permissions: ANALYTICS_PERMISSIONS,
  },
  {
    href: "/phan-tich/fnb",
    title: "Báo cáo vận hành F&B",
    shortTitle: "F&B",
    description: "Các chỉ số bán món, bàn, ca và vận hành cửa hàng F&B.",
    category: "operations",
    icon: "local_cafe",
    keywords: ["quán cà phê", "nhà hàng", "món", "bàn"],
    permissions: FNB_PERMISSIONS,
  },
  {
    href: "/phan-tich/fnb-shipper",
    title: "Hiệu quả shipper F&B",
    shortTitle: "Shipper F&B",
    description: "Theo dõi giao hàng và hiệu suất shipper của cửa hàng.",
    category: "operations",
    icon: "delivery_dining",
    keywords: ["giao hàng", "shipper", "delivery", "đơn giao"],
    permissions: FNB_PERMISSIONS,
  },
  {
    href: "/phan-tich/fnb-modifier",
    title: "Tùy chọn món F&B",
    shortTitle: "Tùy chọn F&B",
    description: "Phân tích topping, size và tùy chọn món được khách lựa chọn.",
    category: "operations",
    icon: "tune",
    keywords: ["modifier", "topping", "size", "option món"],
    permissions: FNB_PERMISSIONS,
  },
  {
    href: "/phan-tich/serve-time",
    title: "Thời gian phục vụ F&B",
    shortTitle: "Thời gian phục vụ",
    description: "Đo thời gian chế biến và phục vụ đơn tại cửa hàng.",
    category: "operations",
    icon: "timer",
    keywords: ["serve time", "kds", "thời gian ra món", "sla"],
    permissions: FNB_PERMISSIONS,
  },
  {
    href: "/phan-tich/nhan-vien",
    title: "Doanh thu theo nhân viên",
    shortTitle: "Nhân viên",
    description: "So sánh doanh thu và số đơn theo nhân viên bán hàng.",
    category: "operations",
    icon: "badge",
    keywords: ["staff", "salesperson", "hiệu suất", "người bán"],
    permissions: ANALYTICS_PERMISSIONS,
  },
  {
    href: "/phan-tich/nha-cung-cap",
    title: "Báo cáo nhà cung cấp",
    shortTitle: "Nhà cung cấp",
    description: "Tổng hợp mua hàng, giá trị nhập và hiệu quả nhà cung cấp.",
    category: "operations",
    icon: "local_shipping",
    keywords: ["supplier", "ncc", "mua hàng", "giá trị nhập"],
    permissions: ANALYTICS_PERMISSIONS,
  },
];

const CATEGORY_BY_ID = new Map(
  REPORT_CATEGORIES.map((category) => [category.id, category]),
);

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

export function getReportByPath(pathname: string): ReportCatalogItem | undefined {
  return REPORT_CATALOG.find((report) => report.href === pathname);
}

export function getReportCategory(id: ReportCategoryId): ReportCategory {
  const category = CATEGORY_BY_ID.get(id);
  if (!category) throw new Error(`Unknown report category: ${id}`);
  return category;
}

export function canAccessReport(
  report: ReportCatalogItem,
  hasPermission: (permission: string) => boolean,
): boolean {
  if (report.permissions.length === 0) return true;
  if (report.permissionMode === "all") {
    return report.permissions.every(hasPermission);
  }
  return report.permissions.some(hasPermission);
}

export function searchReports(
  reports: ReportCatalogItem[],
  query: string,
): ReportCatalogItem[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return reports;

  return reports.filter((report) => {
    const category = getReportCategory(report.category);
    const haystack = normalizeSearchText(
      [
        report.title,
        report.shortTitle,
        report.description,
        category.title,
        ...report.keywords,
      ].join(" "),
    );
    return haystack.includes(normalizedQuery);
  });
}
