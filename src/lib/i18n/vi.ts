/**
 * Từ điển Việt hoá — Sprint VN-1 (CEO 06/05/2026).
 *
 * Mục đích: Đảm bảo mọi chữ trong giao diện viết ĐẦY ĐỦ — không viết tắt.
 * Người dùng kế toán không phải dev, họ cần hiểu ngay không phải đoán.
 *
 * Quy tắc:
 * - KHÔNG viết tắt trong: sidebar, page title, button label, column header,
 *   form label, KPI card label, toast message
 * - CÓ THỂ giữ tên riêng: "Material Symbols", "POS" trong context kỹ thuật
 *   nội bộ (vd file path /pos/...)
 * - Số liệu (vd "T1/2026" tháng) — giữ để gọn, có space đủ
 *
 * Sử dụng:
 *   import { TERMS } from "@/lib/i18n/vi";
 *   <h1>{TERMS.posRetail}</h1>  // "Bán hàng tại quầy"
 */

export const TERMS = {
  // ============================================================
  // POS / Bán hàng
  // ============================================================
  posRetail: "Bán hàng tại quầy",
  posFnb: "Bán hàng quán cà phê",
  pos: "Bán hàng",
  kds: "Màn hình bếp",

  // ============================================================
  // Đối tượng kinh doanh
  // ============================================================
  product: "Sản phẩm",
  products: "Sản phẩm",
  customer: "Khách hàng",
  customers: "Khách hàng",
  supplier: "Nhà cung cấp",
  suppliers: "Nhà cung cấp",
  employee: "Nhân viên",
  employees: "Nhân viên",
  branch: "Chi nhánh",
  branches: "Chi nhánh",

  // ============================================================
  // Chứng từ kế toán
  // ============================================================
  invoice: "Hoá đơn",
  invoices: "Hoá đơn",
  einvoice: "Hoá đơn điện tử",
  purchaseOrder: "Đơn đặt hàng nhập",
  purchaseEntry: "Phiếu nhập hàng",
  purchaseReturn: "Phiếu trả hàng nhập",
  inputInvoice: "Hoá đơn đầu vào",
  salesOrder: "Đơn đặt hàng bán",
  salesReturn: "Phiếu trả hàng",
  shipping: "Vận đơn",
  inventoryCheck: "Phiếu kiểm kho",
  stockTransfer: "Phiếu chuyển kho",
  disposal: "Phiếu xuất huỷ",
  internalExport: "Phiếu xuất dùng nội bộ",
  internalSale: "Phiếu bán nội bộ",
  productionOrder: "Lệnh sản xuất",
  cashTransaction: "Phiếu thu chi",
  cashReceipt: "Phiếu thu",
  cashPayment: "Phiếu chi",

  // ============================================================
  // Đơn vị đo / Số liệu
  // ============================================================
  quantity: "Số lượng",
  qtyShort: "Số lượng",
  value: "Giá trị",
  amount: "Số tiền",
  revenue: "Doanh thu",
  netRevenue: "Doanh thu thuần",
  expense: "Chi phí",
  profit: "Lợi nhuận",
  netProfit: "Lợi nhuận ròng",
  grossProfit: "Lợi nhuận gộp",
  grossMargin: "Biên lợi nhuận gộp",
  netMargin: "Biên lợi nhuận ròng",
  cogs: "Giá vốn hàng bán",
  unitPrice: "Đơn giá",
  costPrice: "Giá vốn",
  sellPrice: "Giá bán",
  unit: "Đơn vị tính",
  category: "Nhóm hàng",
  brand: "Thương hiệu",

  // ============================================================
  // Chỉ số kế toán / KPI
  // ============================================================
  aov: "Giá trị trung bình mỗi đơn",
  dso: "Số ngày thu tiền trung bình",
  inventoryTurnover: "Vòng quay hàng tồn kho",
  receivables: "Khoản phải thu",
  payables: "Khoản phải trả",
  debt: "Công nợ",
  totalDebt: "Tổng công nợ",

  // ============================================================
  // Thanh toán / Vận chuyển
  // ============================================================
  paymentMethod: "Phương thức thanh toán",
  shippingMethod: "Phương thức vận chuyển",
  deliveryStatus: "Trạng thái giao hàng",
  cash: "Tiền mặt",
  transfer: "Chuyển khoản",
  card: "Thẻ",
  ewallet: "Ví điện tử",
  voucher: "Phiếu quà tặng",

  // ============================================================
  // Trạng thái
  // ============================================================
  draft: "Phiếu tạm",
  completed: "Hoàn thành",
  cancelled: "Đã huỷ",
  pending: "Chờ xử lý",
  processing: "Đang xử lý",
  inTransit: "Đang giao",
  delivered: "Đã giao",
  recorded: "Đã ghi sổ",
  unrecorded: "Chưa ghi sổ",

  // ============================================================
  // Thời gian
  // ============================================================
  today: "Hôm nay",
  yesterday: "Hôm qua",
  thisWeek: "Tuần này",
  thisMonth: "Tháng này",
  thisYear: "Năm nay",
  thisQuarter: "Quý này",
  expiry: "Hạn sử dụng",
  expiryDate: "Ngày hết hạn",

  // ============================================================
  // Sản xuất
  // ============================================================
  bom: "Công thức sản xuất",
  rawMaterial: "Nguyên vật liệu",
  finishedGoods: "Thành phẩm",
  productionLot: "Lô sản xuất",
  yieldRate: "Tỷ lệ hao hụt",

  // ============================================================
  // Báo cáo / Phân tích
  // ============================================================
  report: "Báo cáo",
  analytics: "Phân tích",
  xnt: "Xuất - Nhập - Tồn",
  xntDetail: "Xuất - Nhập - Tồn chi tiết",
  pnl: "Báo cáo lãi - lỗ",
  abcAnalysis: "Phân tích ABC theo doanh thu",
  cohortRetention: "Khách hàng quay lại theo tháng đầu mua",
  lotTraceability: "Truy xuất nguồn gốc theo lô",

  // ============================================================
  // Hành động
  // ============================================================
  create: "Tạo mới",
  edit: "Chỉnh sửa",
  duplicate: "Sao chép",
  cancel: "Huỷ",
  delete: "Xoá",
  saveDraft: "Lưu tạm",
  complete: "Hoàn thành",
  apply: "Áp dụng",
  search: "Tìm kiếm",
  filter: "Lọc",
  exportFile: "Xuất file",
  importFile: "Nhập từ file",
  print: "In",
  download: "Tải xuống",
  upload: "Tải lên",
  duplicate_action: "Sao chép",
  recall: "Thu hồi",

  // ============================================================
  // Ghi chú & metadata
  // ============================================================
  note: "Ghi chú",
  reason: "Lý do",
  description: "Mô tả",
  createdBy: "Người tạo",
  updatedBy: "Người cập nhật",
  createdAt: "Ngày tạo",
  updatedAt: "Ngày cập nhật",
  total: "Tổng cộng",
  subtotal: "Tổng phụ",
  discount: "Giảm giá",
  tax: "Thuế",
} as const;

/**
 * Helper format số lượng + đơn vị tính.
 * @example formatQty(5, "kg") → "5 kg"
 */
export function formatQty(qty: number, unit?: string): string {
  if (!unit) return qty.toLocaleString("vi-VN");
  return `${qty.toLocaleString("vi-VN")} ${unit}`;
}

/**
 * Map status code → label tiếng Việt.
 */
export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: TERMS.draft,
    completed: TERMS.completed,
    cancelled: TERMS.cancelled,
    pending: TERMS.pending,
    processing: TERMS.processing,
    confirmed: TERMS.processing,
    in_transit: TERMS.inTransit,
    delivered: TERMS.delivered,
    recorded: TERMS.recorded,
    unrecorded: TERMS.unrecorded,
  };
  return map[status] ?? status;
}
