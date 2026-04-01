import type {
  InventoryCheck,
  ManufacturingOrder,
  DisposalExport,
  InternalExport,
  QueryParams,
  QueryResult,
} from "@/lib/types";
import { simulateDelay, paginateData, searchFilter } from "../base";

// ==================== Inventory Checks (Kiểm kho) ====================

const mockInventoryChecks: InventoryCheck[] = [
  { id: "1", code: "KK000001", date: "2026-03-30T14:20:00", status: "balanced", statusName: "Đã cân bằng", totalProducts: 45, increaseQty: 3, decreaseQty: 3, increaseAmount: 450000, decreaseAmount: 450000, createdBy: "Nguyễn Văn An" },
  { id: "2", code: "KK000002", date: "2026-03-29T09:15:00", status: "unbalanced", statusName: "Lệch", totalProducts: 120, increaseQty: 5, decreaseQty: 8, increaseAmount: 1200000, decreaseAmount: 2400000, note: "Lệch kho tầng 2", createdBy: "Trần Thị Bích" },
  { id: "3", code: "KK000003", date: "2026-03-28T16:30:00", status: "processing", statusName: "Đang xử lý", totalProducts: 78, increaseQty: 0, decreaseQty: 0, increaseAmount: 0, decreaseAmount: 0, createdBy: "Lê Hoàng Cường" },
  { id: "4", code: "KK000004", date: "2026-03-27T10:00:00", status: "balanced", statusName: "Đã cân bằng", totalProducts: 200, increaseQty: 10, decreaseQty: 10, increaseAmount: 3500000, decreaseAmount: 3500000, createdBy: "Phạm Minh Đức" },
  { id: "5", code: "KK000005", date: "2026-03-26T08:45:00", status: "unbalanced", statusName: "Lệch", totalProducts: 55, increaseQty: 2, decreaseQty: 7, increaseAmount: 600000, decreaseAmount: 1850000, note: "Thiếu hàng mỹ phẩm", createdBy: "Hoàng Thị Em" },
  { id: "6", code: "KK000006", date: "2026-03-25T13:10:00", status: "balanced", statusName: "Đã cân bằng", totalProducts: 90, increaseQty: 4, decreaseQty: 4, increaseAmount: 800000, decreaseAmount: 800000, createdBy: "Võ Văn Phúc" },
  { id: "7", code: "KK000007", date: "2026-03-24T11:20:00", status: "processing", statusName: "Đang xử lý", totalProducts: 150, increaseQty: 0, decreaseQty: 0, increaseAmount: 0, decreaseAmount: 0, createdBy: "Đặng Thị Giang" },
  { id: "8", code: "KK000008", date: "2026-03-23T15:50:00", status: "unbalanced", statusName: "Lệch", totalProducts: 67, increaseQty: 8, decreaseQty: 3, increaseAmount: 2100000, decreaseAmount: 750000, note: "Thừa hàng điện tử", createdBy: "Bùi Quang Hải" },
  { id: "9", code: "KK000009", date: "2026-03-22T09:30:00", status: "balanced", statusName: "Đã cân bằng", totalProducts: 310, increaseQty: 15, decreaseQty: 15, increaseAmount: 5200000, decreaseAmount: 5200000, createdBy: "Ngô Thị Hương" },
  { id: "10", code: "KK000010", date: "2026-03-21T14:00:00", status: "balanced", statusName: "Đã cân bằng", totalProducts: 42, increaseQty: 1, decreaseQty: 1, increaseAmount: 150000, decreaseAmount: 150000, createdBy: "Trịnh Văn Khoa" },
  { id: "11", code: "KK000011", date: "2026-03-20T10:45:00", status: "unbalanced", statusName: "Lệch", totalProducts: 88, increaseQty: 0, decreaseQty: 5, increaseAmount: 0, decreaseAmount: 1350000, note: "Hao hụt thực phẩm", createdBy: "Lý Thị Loan" },
  { id: "12", code: "KK000012", date: "2026-03-19T08:20:00", status: "processing", statusName: "Đang xử lý", totalProducts: 175, increaseQty: 0, decreaseQty: 0, increaseAmount: 0, decreaseAmount: 0, createdBy: "Phan Đức Mạnh" },
  { id: "13", code: "KK000013", date: "2026-03-18T16:15:00", status: "balanced", statusName: "Đã cân bằng", totalProducts: 63, increaseQty: 6, decreaseQty: 6, increaseAmount: 1800000, decreaseAmount: 1800000, createdBy: "Dương Thị Ngọc" },
  { id: "14", code: "KK000014", date: "2026-03-17T12:00:00", status: "unbalanced", statusName: "Lệch", totalProducts: 95, increaseQty: 12, decreaseQty: 4, increaseAmount: 3600000, decreaseAmount: 980000, note: "Nhập thừa đợt trước", createdBy: "Hồ Văn Phong" },
  { id: "15", code: "KK000015", date: "2026-03-16T09:00:00", status: "balanced", statusName: "Đã cân bằng", totalProducts: 130, increaseQty: 7, decreaseQty: 7, increaseAmount: 2100000, decreaseAmount: 2100000, createdBy: "Mai Thị Quỳnh" },
  { id: "16", code: "KK000016", date: "2026-03-15T14:30:00", status: "processing", statusName: "Đang xử lý", totalProducts: 210, increaseQty: 0, decreaseQty: 0, increaseAmount: 0, decreaseAmount: 0, createdBy: "Tô Văn Sơn" },
  { id: "17", code: "KK000017", date: "2026-03-14T11:10:00", status: "balanced", statusName: "Đã cân bằng", totalProducts: 50, increaseQty: 2, decreaseQty: 2, increaseAmount: 500000, decreaseAmount: 500000, createdBy: "Vương Thị Tâm" },
  { id: "18", code: "KK000018", date: "2026-03-13T15:40:00", status: "unbalanced", statusName: "Lệch", totalProducts: 74, increaseQty: 3, decreaseQty: 9, increaseAmount: 720000, decreaseAmount: 2700000, note: "Lệch kho chi nhánh 3", createdBy: "Châu Minh Uy" },
  { id: "19", code: "KK000019", date: "2026-03-12T10:25:00", status: "balanced", statusName: "Đã cân bằng", totalProducts: 160, increaseQty: 9, decreaseQty: 9, increaseAmount: 2700000, decreaseAmount: 2700000, createdBy: "Đinh Thị Vân" },
  { id: "20", code: "KK000020", date: "2026-03-11T08:00:00", status: "processing", statusName: "Đang xử lý", totalProducts: 98, increaseQty: 0, decreaseQty: 0, increaseAmount: 0, decreaseAmount: 0, createdBy: "Lương Văn Xuân" },
];

export async function getInventoryChecks(params: QueryParams): Promise<QueryResult<InventoryCheck>> {
  await simulateDelay();
  let filtered = searchFilter(mockInventoryChecks, params.search, ["code"]);

  if (params.filters?.status && params.filters.status !== "all" && params.filters.status !== "") {
    filtered = filtered.filter((item) => item.status === params.filters!.status);
  }

  return paginateData(filtered, params.page, params.pageSize);
}

export function getInventoryCheckStatuses() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "balanced", label: "Đã cân bằng" },
    { value: "unbalanced", label: "Lệch" },
    { value: "processing", label: "Đang xử lý" },
  ];
}

// ==================== Manufacturing Orders (Sản xuất) ====================

const mockManufacturingOrders: ManufacturingOrder[] = [
  { id: "1", code: "PSX000001", date: "2026-03-30T14:20:00", productName: "Bánh mì ngọt", productCode: "SP001", quantity: 200, status: "completed", statusName: "Hoàn thành", costAmount: 3000000, createdBy: "Nguyễn Văn A" },
  { id: "2", code: "PSX000002", date: "2026-03-29T09:15:00", productName: "Bánh mì mặn", productCode: "SP002", quantity: 150, status: "completed", statusName: "Hoàn thành", costAmount: 2700000, createdBy: "Trần Thị B" },
  { id: "3", code: "PSX000003", date: "2026-03-28T16:30:00", productName: "Nước ép cam", productCode: "SP003", quantity: 500, status: "processing", statusName: "Đang xử lý", costAmount: 5000000, createdBy: "Lê Văn C" },
  { id: "4", code: "PSX000004", date: "2026-03-27T08:45:00", productName: "Sữa chua trái cây", productCode: "SP004", quantity: 300, status: "completed", statusName: "Hoàn thành", costAmount: 4500000, createdBy: "Phạm Thị D" },
  { id: "5", code: "PSX000005", date: "2026-03-26T11:00:00", productName: "Bánh quy bơ", productCode: "SP005", quantity: 100, status: "cancelled", statusName: "Đã hủy", costAmount: 1500000, createdBy: "Nguyễn Văn A" },
  { id: "6", code: "PSX000006", date: "2026-03-25T13:30:00", productName: "Bánh mì ngọt", productCode: "SP001", quantity: 250, status: "completed", statusName: "Hoàn thành", costAmount: 3750000, createdBy: "Trần Thị B" },
  { id: "7", code: "PSX000007", date: "2026-03-24T10:00:00", productName: "Nước ép dưa hấu", productCode: "SP006", quantity: 400, status: "processing", statusName: "Đang xử lý", costAmount: 3200000, createdBy: "Lê Văn C" },
  { id: "8", code: "PSX000008", date: "2026-03-23T15:45:00", productName: "Kem socola", productCode: "SP007", quantity: 80, status: "completed", statusName: "Hoàn thành", costAmount: 2400000, createdBy: "Phạm Thị D" },
  { id: "9", code: "PSX000009", date: "2026-03-22T07:30:00", productName: "Bánh bông lan", productCode: "SP008", quantity: 120, status: "completed", statusName: "Hoàn thành", costAmount: 1800000, createdBy: "Nguyễn Văn A" },
  { id: "10", code: "PSX000010", date: "2026-03-21T09:00:00", productName: "Sữa đậu nành", productCode: "SP009", quantity: 600, status: "processing", statusName: "Đang xử lý", costAmount: 4200000, createdBy: "Trần Thị B" },
  { id: "11", code: "PSX000011", date: "2026-03-20T14:15:00", productName: "Bánh cuốn", productCode: "SP010", quantity: 180, status: "completed", statusName: "Hoàn thành", costAmount: 2160000, createdBy: "Lê Văn C" },
  { id: "12", code: "PSX000012", date: "2026-03-19T11:30:00", productName: "Nước ép cam", productCode: "SP003", quantity: 350, status: "cancelled", statusName: "Đã hủy", costAmount: 3500000, createdBy: "Phạm Thị D" },
  { id: "13", code: "PSX000013", date: "2026-03-18T08:00:00", productName: "Bánh mì mặn", productCode: "SP002", quantity: 200, status: "completed", statusName: "Hoàn thành", costAmount: 3600000, createdBy: "Nguyễn Văn A" },
  { id: "14", code: "PSX000014", date: "2026-03-17T16:00:00", productName: "Kem vani", productCode: "SP011", quantity: 90, status: "processing", statusName: "Đang xử lý", costAmount: 2700000, createdBy: "Trần Thị B" },
  { id: "15", code: "PSX000015", date: "2026-03-16T10:45:00", productName: "Bánh quy bơ", productCode: "SP005", quantity: 160, status: "completed", statusName: "Hoàn thành", costAmount: 2400000, createdBy: "Lê Văn C" },
];

export async function getManufacturingOrders(params: QueryParams): Promise<QueryResult<ManufacturingOrder>> {
  await simulateDelay();
  let filtered = searchFilter(mockManufacturingOrders, params.search, ["code"]);

  if (params.filters?.status && params.filters.status !== "all") {
    filtered = filtered.filter((item) => item.status === params.filters!.status);
  }

  return paginateData(filtered, params.page, params.pageSize);
}

export function getManufacturingStatuses() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "completed", label: "Hoàn thành" },
    { value: "processing", label: "Đang xử lý" },
    { value: "cancelled", label: "Đã hủy" },
  ];
}

// ==================== Disposal Exports (Xuất hủy) ====================

const mockDisposalExports: DisposalExport[] = [
  { id: "1", code: "XH000001", date: "2026-03-30T10:30:00", totalProducts: 5, totalAmount: 1200000, reason: "Hàng hết hạn sử dụng", status: "completed", statusName: "Hoàn thành", createdBy: "Nguyễn Văn A" },
  { id: "2", code: "XH000002", date: "2026-03-28T14:00:00", totalProducts: 3, totalAmount: 850000, reason: "Hàng bị hỏng", status: "completed", statusName: "Hoàn thành", createdBy: "Trần Thị B" },
  { id: "3", code: "XH000003", date: "2026-03-27T09:15:00", totalProducts: 8, totalAmount: 3200000, reason: "Hàng lỗi từ nhà cung cấp", status: "draft", statusName: "Phiếu tạm", createdBy: "Lê Văn C" },
  { id: "4", code: "XH000004", date: "2026-03-25T16:45:00", totalProducts: 2, totalAmount: 650000, reason: "Hàng hết hạn sử dụng", status: "completed", statusName: "Hoàn thành", createdBy: "Phạm Thị D" },
  { id: "5", code: "XH000005", date: "2026-03-24T11:20:00", totalProducts: 12, totalAmount: 5400000, reason: "Hàng bị ẩm mốc", status: "completed", statusName: "Hoàn thành", createdBy: "Nguyễn Văn A" },
  { id: "6", code: "XH000006", date: "2026-03-23T08:00:00", totalProducts: 4, totalAmount: 1800000, reason: "Hàng bị hỏng do vận chuyển", status: "draft", statusName: "Phiếu tạm", createdBy: "Trần Thị B" },
  { id: "7", code: "XH000007", date: "2026-03-22T13:30:00", totalProducts: 6, totalAmount: 2100000, reason: "Hàng lỗi kỹ thuật", status: "completed", statusName: "Hoàn thành", createdBy: "Lê Văn C" },
  { id: "8", code: "XH000008", date: "2026-03-20T15:00:00", totalProducts: 1, totalAmount: 350000, reason: "Hàng hết hạn sử dụng", status: "completed", statusName: "Hoàn thành", createdBy: "Phạm Thị D" },
  { id: "9", code: "XH000009", date: "2026-03-19T10:45:00", totalProducts: 7, totalAmount: 2900000, reason: "Hàng bị hỏng", status: "draft", statusName: "Phiếu tạm", createdBy: "Nguyễn Văn A" },
  { id: "10", code: "XH000010", date: "2026-03-18T09:00:00", totalProducts: 3, totalAmount: 1100000, reason: "Thu hồi sản phẩm", status: "completed", statusName: "Hoàn thành", createdBy: "Trần Thị B" },
];

export async function getDisposalExports(params: QueryParams): Promise<QueryResult<DisposalExport>> {
  await simulateDelay();
  let filtered = searchFilter(mockDisposalExports, params.search, ["code"]);

  if (params.filters?.status && params.filters.status !== "all") {
    filtered = filtered.filter((item) => item.status === params.filters!.status);
  }

  return paginateData(filtered, params.page, params.pageSize);
}

export function getDisposalStatuses() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "completed", label: "Hoàn thành" },
    { value: "draft", label: "Phiếu tạm" },
  ];
}

// ==================== Internal Exports (Xuất nội bộ) ====================

const mockInternalExports: InternalExport[] = [
  { id: "1", code: "XNBP000001", date: "2026-03-30T10:00:00", totalProducts: 5, totalAmount: 2500000, status: "completed", statusName: "Hoàn thành", note: "Dùng cho văn phòng", createdBy: "Nguyễn Văn A" },
  { id: "2", code: "XNBP000002", date: "2026-03-29T14:30:00", totalProducts: 3, totalAmount: 1800000, status: "draft", statusName: "Phiếu tạm", note: "Dùng cho kho", createdBy: "Trần Thị B" },
  { id: "3", code: "XNBP000003", date: "2026-03-28T09:15:00", totalProducts: 8, totalAmount: 4200000, status: "completed", statusName: "Hoàn thành", createdBy: "Lê Văn C" },
  { id: "4", code: "XNBP000004", date: "2026-03-27T16:45:00", totalProducts: 2, totalAmount: 900000, status: "completed", statusName: "Hoàn thành", note: "Cho bộ phận bán hàng", createdBy: "Phạm Thị D" },
  { id: "5", code: "XNBP000005", date: "2026-03-26T08:30:00", totalProducts: 10, totalAmount: 6500000, status: "draft", statusName: "Phiếu tạm", createdBy: "Nguyễn Văn A" },
  { id: "6", code: "XNBP000006", date: "2026-03-25T11:00:00", totalProducts: 4, totalAmount: 2100000, status: "completed", statusName: "Hoàn thành", note: "Quà tặng nhân viên", createdBy: "Trần Thị B" },
  { id: "7", code: "XNBP000007", date: "2026-03-24T15:20:00", totalProducts: 6, totalAmount: 3300000, status: "completed", statusName: "Hoàn thành", createdBy: "Lê Văn C" },
  { id: "8", code: "XNBP000008", date: "2026-03-23T13:10:00", totalProducts: 1, totalAmount: 450000, status: "draft", statusName: "Phiếu tạm", note: "Dùng thử sản phẩm mới", createdBy: "Phạm Thị D" },
  { id: "9", code: "XNBP000009", date: "2026-03-22T10:30:00", totalProducts: 7, totalAmount: 3800000, status: "completed", statusName: "Hoàn thành", createdBy: "Nguyễn Văn A" },
  { id: "10", code: "XNBP000010", date: "2026-03-21T08:00:00", totalProducts: 3, totalAmount: 1600000, status: "completed", statusName: "Hoàn thành", note: "Cho chi nhánh 2", createdBy: "Trần Thị B" },
  { id: "11", code: "XNBP000011", date: "2026-03-20T14:00:00", totalProducts: 5, totalAmount: 2750000, status: "draft", statusName: "Phiếu tạm", createdBy: "Lê Văn C" },
  { id: "12", code: "XNBP000012", date: "2026-03-19T09:45:00", totalProducts: 9, totalAmount: 5100000, status: "completed", statusName: "Hoàn thành", note: "Sự kiện công ty", createdBy: "Phạm Thị D" },
];

export async function getInternalExports(params: QueryParams): Promise<QueryResult<InternalExport>> {
  await simulateDelay();
  let filtered = searchFilter(mockInternalExports, params.search, ["code"]);

  if (params.filters?.status && params.filters.status !== "all") {
    filtered = filtered.filter((item) => item.status === params.filters!.status);
  }

  return paginateData(filtered, params.page, params.pageSize);
}

export function getInternalExportStatuses() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "completed", label: "Hoàn thành" },
    { value: "draft", label: "Phiếu tạm" },
  ];
}
