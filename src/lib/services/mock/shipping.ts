import type { ShippingOrder, DeliveryPartner, QueryParams, QueryResult } from "@/lib/types";
import { simulateDelay, paginateData, searchFilter } from "../base";

// ==================== Shipping Orders ====================

const mockShippingOrders: ShippingOrder[] = [
  { id: "1", code: "VD000001", invoiceCode: "HD000120", deliveryPartner: "Giao Hàng Nhanh", customerName: "Nguyễn Văn An", customerPhone: "0901234567", address: "123 Nguyễn Huệ, P.Bến Nghé, Q.1, TP.HCM", status: "pending", statusName: "Chờ lấy hàng", fee: 25000, cod: 1250000, createdAt: "2026-03-31T08:30:00" },
  { id: "2", code: "VD000002", invoiceCode: "HD000119", deliveryPartner: "Viettel Post", customerName: "Trần Thị Bích", customerPhone: "0912345678", address: "45 Lê Lợi, P.Bến Thành, Q.1, TP.HCM", status: "picking", statusName: "Đang lấy hàng", fee: 22000, cod: 3450000, createdAt: "2026-03-31T09:00:00" },
  { id: "3", code: "VD000003", invoiceCode: "HD000118", deliveryPartner: "Giao Hàng Tiết Kiệm", customerName: "Lê Hoàng Cường", customerPhone: "0923456789", address: "78 Trần Hưng Đạo, P.7, Q.5, TP.HCM", status: "shipping", statusName: "Đang giao", fee: 18000, cod: 890000, createdAt: "2026-03-30T14:00:00" },
  { id: "4", code: "VD000004", invoiceCode: "HD000117", deliveryPartner: "J&T Express", customerName: "Phạm Thị Dung", customerPhone: "0934567890", address: "256 Hai Bà Trưng, P.Tân Định, Q.1, TP.HCM", status: "delivered", statusName: "Đã giao", fee: 30000, cod: 5670000, createdAt: "2026-03-30T10:30:00" },
  { id: "5", code: "VD000005", invoiceCode: "HD000116", deliveryPartner: "GrabExpress", customerName: "Hoàng Văn Em", customerPhone: "0945678901", address: "12 Pasteur, P.Nguyễn Thái Bình, Q.1, TP.HCM", status: "failed", statusName: "Giao thất bại", fee: 20000, cod: 2340000, createdAt: "2026-03-29T16:15:00" },
  { id: "6", code: "VD000006", invoiceCode: "HD000115", deliveryPartner: "Ninja Van", customerName: "Vũ Thị Phương", customerPhone: "0956789012", address: "89 Nguyễn Thị Minh Khai, P.Bến Nghé, Q.1, TP.HCM", status: "returned", statusName: "Đã hoàn", fee: 25000, cod: 4120000, createdAt: "2026-03-29T11:00:00" },
  { id: "7", code: "VD000007", invoiceCode: "HD000114", deliveryPartner: "Giao Hàng Nhanh", customerName: "Đặng Quốc Gia", customerPhone: "0967890123", address: "34 Điện Biên Phủ, P.Đa Kao, Q.1, TP.HCM", status: "delivered", statusName: "Đã giao", fee: 22000, cod: 1780000, createdAt: "2026-03-28T08:45:00" },
  { id: "8", code: "VD000008", invoiceCode: "HD000113", deliveryPartner: "Viettel Post", customerName: "Bùi Thị Hạnh", customerPhone: "0978901234", address: "167 Cách Mạng Tháng 8, P.5, Q.3, TP.HCM", status: "shipping", statusName: "Đang giao", fee: 28000, cod: 6230000, createdAt: "2026-03-28T15:20:00" },
  { id: "9", code: "VD000009", invoiceCode: "HD000112", deliveryPartner: "Giao Hàng Tiết Kiệm", customerName: "Ngô Minh Khải", customerPhone: "0989012345", address: "55 Võ Văn Tần, P.6, Q.3, TP.HCM", status: "delivered", statusName: "Đã giao", fee: 15000, cod: 950000, createdAt: "2026-03-27T09:30:00" },
  { id: "10", code: "VD000010", invoiceCode: "HD000111", deliveryPartner: "J&T Express", customerName: "Lý Thị Lan", customerPhone: "0990123456", address: "201 Nguyễn Văn Cừ, P.4, Q.5, TP.HCM", status: "pending", statusName: "Chờ lấy hàng", fee: 32000, cod: 3890000, createdAt: "2026-03-27T13:15:00" },
  { id: "11", code: "VD000011", invoiceCode: "HD000110", deliveryPartner: "GrabExpress", customerName: "Đỗ Văn Mạnh", customerPhone: "0361234567", address: "78 Lý Thường Kiệt, P.14, Q.10, TP.HCM", status: "picking", statusName: "Đang lấy hàng", fee: 20000, cod: 7450000, createdAt: "2026-03-26T10:00:00" },
  { id: "12", code: "VD000012", invoiceCode: "HD000109", deliveryPartner: "Ninja Van", customerName: "Trịnh Thị Ngọc", customerPhone: "0372345678", address: "145 Nguyễn Trãi, P.2, Q.5, TP.HCM", status: "shipping", statusName: "Đang giao", fee: 24000, cod: 2100000, createdAt: "2026-03-26T14:30:00" },
  { id: "13", code: "VD000013", invoiceCode: "HD000108", deliveryPartner: "Giao Hàng Nhanh", customerName: "Phan Quốc Oai", customerPhone: "0383456789", address: "320 An Dương Vương, P.4, Q.5, TP.HCM", status: "delivered", statusName: "Đã giao", fee: 18000, cod: 4560000, createdAt: "2026-03-25T08:15:00" },
  { id: "14", code: "VD000014", invoiceCode: "HD000107", deliveryPartner: "Viettel Post", customerName: "Mai Thị Phượng", customerPhone: "0394567890", address: "67 Phan Xích Long, P.2, Q.Phú Nhuận, TP.HCM", status: "failed", statusName: "Giao thất bại", fee: 25000, cod: 1340000, createdAt: "2026-03-25T11:45:00" },
  { id: "15", code: "VD000015", invoiceCode: "HD000106", deliveryPartner: "Giao Hàng Tiết Kiệm", customerName: "Cao Văn Quang", customerPhone: "0705678901", address: "234 Lê Văn Sỹ, P.14, Q.3, TP.HCM", status: "delivered", statusName: "Đã giao", fee: 20000, cod: 8900000, createdAt: "2026-03-24T16:00:00" },
  { id: "16", code: "VD000016", invoiceCode: "HD000105", deliveryPartner: "J&T Express", customerName: "Đinh Thị Rạng", customerPhone: "0716789012", address: "18 Hồ Xuân Hương, P.6, Q.3, TP.HCM", status: "pending", statusName: "Chờ lấy hàng", fee: 28000, cod: 2670000, createdAt: "2026-03-24T09:20:00" },
  { id: "17", code: "VD000017", invoiceCode: "HD000104", deliveryPartner: "GrabExpress", customerName: "Tạ Minh Sơn", customerPhone: "0727890123", address: "90 Bùi Viện, P.Phạm Ngũ Lão, Q.1, TP.HCM", status: "shipping", statusName: "Đang giao", fee: 18000, cod: 5120000, createdAt: "2026-03-23T13:40:00" },
  { id: "18", code: "VD000018", invoiceCode: "HD000103", deliveryPartner: "Ninja Van", customerName: "Hà Thị Trang", customerPhone: "0738901234", address: "456 Nguyễn Đình Chiểu, P.4, Q.3, TP.HCM", status: "delivered", statusName: "Đã giao", fee: 22000, cod: 1890000, createdAt: "2026-03-23T10:00:00" },
  { id: "19", code: "VD000019", invoiceCode: "HD000102", deliveryPartner: "Giao Hàng Nhanh", customerName: "Lương Văn Uy", customerPhone: "0749012345", address: "12 Trương Định, P.6, Q.3, TP.HCM", status: "returned", statusName: "Đã hoàn", fee: 25000, cod: 3210000, createdAt: "2026-03-22T15:50:00" },
  { id: "20", code: "VD000020", invoiceCode: "HD000101", deliveryPartner: "Viettel Post", customerName: "Châu Thị Vân", customerPhone: "0750123456", address: "789 Xô Viết Nghệ Tĩnh, P.26, Q.Bình Thạnh, TP.HCM", status: "delivered", statusName: "Đã giao", fee: 30000, cod: 6780000, createdAt: "2026-03-22T08:30:00" },
  { id: "21", code: "VD000021", invoiceCode: "HD000100", deliveryPartner: "Giao Hàng Tiết Kiệm", customerName: "Dương Xuân Bắc", customerPhone: "0561234567", address: "34 Nguyễn Công Trứ, P.Nguyễn Thái Bình, Q.1, TP.HCM", status: "picking", statusName: "Đang lấy hàng", fee: 15000, cod: 4350000, createdAt: "2026-03-21T11:10:00" },
  { id: "22", code: "VD000022", invoiceCode: "HD000099", deliveryPartner: "J&T Express", customerName: "Tô Thị Yến", customerPhone: "0572345678", address: "56 Thái Văn Lung, P.Bến Nghé, Q.1, TP.HCM", status: "shipping", statusName: "Đang giao", fee: 20000, cod: 990000, createdAt: "2026-03-21T14:40:00" },
  { id: "23", code: "VD000023", invoiceCode: "HD000098", deliveryPartner: "GrabExpress", customerName: "Kiều Văn Đạt", customerPhone: "0583456789", address: "678 Sư Vạn Hạnh, P.12, Q.10, TP.HCM", status: "delivered", statusName: "Đã giao", fee: 22000, cod: 7230000, createdAt: "2026-03-20T09:25:00" },
  { id: "24", code: "VD000024", invoiceCode: "HD000097", deliveryPartner: "Ninja Van", customerName: "Quách Thị Hiền", customerPhone: "0594567890", address: "101 Hùng Vương, P.4, Q.5, TP.HCM", status: "pending", statusName: "Chờ lấy hàng", fee: 28000, cod: 1560000, createdAt: "2026-03-20T16:55:00" },
  { id: "25", code: "VD000025", invoiceCode: "HD000096", deliveryPartner: "Giao Hàng Nhanh", customerName: "Thái Bảo Long", customerPhone: "0865678901", address: "225 Phạm Ngũ Lão, P.Phạm Ngũ Lão, Q.1, TP.HCM", status: "delivered", statusName: "Đã giao", fee: 18000, cod: 4890000, createdAt: "2026-03-19T12:10:00" },
  { id: "26", code: "VD000026", invoiceCode: "HD000095", deliveryPartner: "Viettel Post", customerName: "Võ Thanh Hải", customerPhone: "0876789012", address: "43 Trần Quang Khải, P.Tân Định, Q.1, TP.HCM", status: "shipping", statusName: "Đang giao", fee: 25000, cod: 2450000, createdAt: "2026-03-19T08:00:00" },
  { id: "27", code: "VD000027", invoiceCode: "HD000094", deliveryPartner: "Giao Hàng Tiết Kiệm", customerName: "Huỳnh Minh Tuấn", customerPhone: "0887890123", address: "312 Lý Chính Thắng, P.9, Q.3, TP.HCM", status: "failed", statusName: "Giao thất bại", fee: 20000, cod: 5340000, createdAt: "2026-03-18T15:30:00" },
  { id: "28", code: "VD000028", invoiceCode: "HD000093", deliveryPartner: "J&T Express", customerName: "Trương Thị Mai", customerPhone: "0898901234", address: "67 Nguyễn Bỉnh Khiêm, P.Đa Kao, Q.1, TP.HCM", status: "delivered", statusName: "Đã giao", fee: 30000, cod: 3780000, createdAt: "2026-03-18T10:45:00" },
  { id: "29", code: "VD000029", invoiceCode: "HD000092", deliveryPartner: "GrabExpress", customerName: "Lại Văn Phong", customerPhone: "0349012345", address: "189 Võ Thị Sáu, P.7, Q.3, TP.HCM", status: "returned", statusName: "Đã hoàn", fee: 22000, cod: 1120000, createdAt: "2026-03-17T14:20:00" },
  { id: "30", code: "VD000030", invoiceCode: "HD000091", deliveryPartner: "Ninja Van", customerName: "Ông Thị Kim", customerPhone: "0350123456", address: "456 Đinh Tiên Hoàng, P.1, Q.Bình Thạnh, TP.HCM", status: "pending", statusName: "Chờ lấy hàng", fee: 28000, cod: 6540000, createdAt: "2026-03-17T09:00:00" },
];

export async function getShippingOrders(params: QueryParams): Promise<QueryResult<ShippingOrder>> {
  await simulateDelay();
  let filtered = searchFilter(mockShippingOrders, params.search, ["code", "customerPhone"]);

  if (params.filters?.status && params.filters.status !== "all") {
    filtered = filtered.filter((o) => o.status === params.filters!.status);
  }

  if (params.filters?.partner && params.filters.partner !== "all") {
    filtered = filtered.filter((o) => o.deliveryPartner === params.filters!.partner);
  }

  return paginateData(filtered, params.page, params.pageSize);
}

export function getShippingStatuses() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "pending", label: "Chờ lấy hàng" },
    { value: "picking", label: "Đang lấy hàng" },
    { value: "shipping", label: "Đang giao" },
    { value: "delivered", label: "Đã giao" },
    { value: "failed", label: "Giao thất bại" },
    { value: "returned", label: "Đã hoàn" },
  ];
}

// ==================== Delivery Partners ====================

const mockPartners: DeliveryPartner[] = [
  { id: "1", name: "GrabExpress", phone: "1900636836", email: "support@grab.com", address: "Tầng 35, Bitexco Financial Tower, Q.1, TP.HCM", activeOrders: 12, completedOrders: 345, status: "active", statusName: "Đang hoạt động", createdAt: "2025-01-15T08:00:00" },
  { id: "2", name: "Giao Hàng Nhanh", phone: "1900636688", email: "hotro@ghn.vn", address: "405/15 Xô Viết Nghệ Tĩnh, P.25, Q.Bình Thạnh, TP.HCM", activeOrders: 28, completedOrders: 1230, status: "active", statusName: "Đang hoạt động", createdAt: "2024-06-10T09:30:00" },
  { id: "3", name: "Giao Hàng Tiết Kiệm", phone: "1900636620", email: "hotro@ghtk.vn", address: "Tầng 5, 102 Thái Thịnh, Q.Đống Đa, Hà Nội", activeOrders: 35, completedOrders: 2150, status: "active", statusName: "Đang hoạt động", createdAt: "2024-03-22T10:00:00" },
  { id: "4", name: "J&T Express", phone: "1900120077", email: "cs@jtexpress.vn", address: "Tầng 3, 27A Cộng Hòa, P.4, Q.Tân Bình, TP.HCM", activeOrders: 18, completedOrders: 876, status: "active", statusName: "Đang hoạt động", createdAt: "2024-08-05T14:20:00" },
  { id: "5", name: "Viettel Post", phone: "1900866868", email: "cskh@viettelpost.com.vn", address: "Tầng 2, Tòa nhà HH4, Sông Đà, Q.Nam Từ Liêm, Hà Nội", activeOrders: 22, completedOrders: 1580, status: "active", statusName: "Đang hoạt động", createdAt: "2024-02-18T08:45:00" },
  { id: "6", name: "BEST Express", phone: "1900636033", email: "cskh@best-inc.vn", address: "Tầng 6, 81 Cách Mạng Tháng 8, P.Bến Thành, Q.1, TP.HCM", activeOrders: 0, completedOrders: 420, status: "inactive", statusName: "Ngừng hoạt động", createdAt: "2024-11-30T11:00:00" },
  { id: "7", name: "Ninja Van", phone: "1900886877", email: "support@ninjavan.co", address: "Lô E2a-7, Đường D1, Khu CNC, Q.9, TP.HCM", activeOrders: 8, completedOrders: 567, status: "active", statusName: "Đang hoạt động", createdAt: "2025-02-01T09:15:00" },
  { id: "8", name: "Ahamove", phone: "1900545411", email: "support@ahamove.com", address: "Tầng 7, Viettel Complex, 285 CMT8, P.12, Q.10, TP.HCM", activeOrders: 5, completedOrders: 198, status: "active", statusName: "Đang hoạt động", createdAt: "2025-05-12T16:30:00" },
];

export async function getDeliveryPartners(params: QueryParams): Promise<QueryResult<DeliveryPartner>> {
  await simulateDelay();
  const filtered = searchFilter(mockPartners, params.search, ["name"]);
  return paginateData(filtered, params.page, params.pageSize);
}

export function getPartnerOptions() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "GrabExpress", label: "GrabExpress" },
    { value: "Giao Hàng Nhanh", label: "Giao Hàng Nhanh" },
    { value: "Giao Hàng Tiết Kiệm", label: "Giao Hàng Tiết Kiệm" },
    { value: "J&T Express", label: "J&T Express" },
    { value: "Viettel Post", label: "Viettel Post" },
    { value: "Ninja Van", label: "Ninja Van" },
  ];
}
