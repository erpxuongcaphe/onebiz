/**
 * Danh sách 34 tỉnh/thành Việt Nam sau sáp nhập (Nghị quyết QH 2025, hiệu lực 01/07/2025).
 *
 * Dùng cho dropdown chọn Tỉnh/TP trong form Khách hàng + Nhà cung cấp.
 * Filter theo province ở các trang KH/NCC/báo cáo địa lý.
 *
 * Field `merged` ghi chú các tỉnh cũ đã sáp nhập vào → user nhập địa chỉ cũ
 * vẫn map được. CEO 17/05/2026.
 */

export interface VnProvince {
  /** Mã tỉnh ngắn (slug an toàn cho URL/filter) */
  code: string;
  /** Tên đầy đủ hiển thị */
  name: string;
  /** Loại: TP trực thuộc TW hoặc Tỉnh */
  type: "TP" | "Tỉnh";
  /** Các tỉnh cũ đã sáp nhập (giữ search-friendly) */
  merged?: string[];
}

export const VN_PROVINCES: readonly VnProvince[] = [
  // 6 thành phố trực thuộc trung ương
  { code: "ha-noi", name: "TP. Hà Nội", type: "TP" },
  {
    code: "hcm",
    name: "TP. Hồ Chí Minh",
    type: "TP",
    merged: ["Bình Dương", "Bà Rịa - Vũng Tàu"],
  },
  {
    code: "hai-phong",
    name: "TP. Hải Phòng",
    type: "TP",
    merged: ["Hải Dương"],
  },
  {
    code: "da-nang",
    name: "TP. Đà Nẵng",
    type: "TP",
    merged: ["Quảng Nam"],
  },
  {
    code: "can-tho",
    name: "TP. Cần Thơ",
    type: "TP",
    merged: ["Hậu Giang", "Sóc Trăng"],
  },
  { code: "hue", name: "TP. Huế", type: "TP" },

  // 28 tỉnh
  { code: "lai-chau", name: "Lai Châu", type: "Tỉnh" },
  { code: "dien-bien", name: "Điện Biên", type: "Tỉnh" },
  { code: "son-la", name: "Sơn La", type: "Tỉnh" },
  { code: "lang-son", name: "Lạng Sơn", type: "Tỉnh" },
  { code: "quang-ninh", name: "Quảng Ninh", type: "Tỉnh" },
  { code: "thanh-hoa", name: "Thanh Hóa", type: "Tỉnh" },
  { code: "nghe-an", name: "Nghệ An", type: "Tỉnh" },
  { code: "ha-tinh", name: "Hà Tĩnh", type: "Tỉnh" },
  { code: "cao-bang", name: "Cao Bằng", type: "Tỉnh" },
  {
    code: "tuyen-quang",
    name: "Tuyên Quang",
    type: "Tỉnh",
    merged: ["Hà Giang"],
  },
  { code: "lao-cai", name: "Lào Cai", type: "Tỉnh", merged: ["Yên Bái"] },
  {
    code: "thai-nguyen",
    name: "Thái Nguyên",
    type: "Tỉnh",
    merged: ["Bắc Kạn"],
  },
  {
    code: "phu-tho",
    name: "Phú Thọ",
    type: "Tỉnh",
    merged: ["Vĩnh Phúc", "Hòa Bình"],
  },
  {
    code: "bac-ninh",
    name: "Bắc Ninh",
    type: "Tỉnh",
    merged: ["Bắc Giang"],
  },
  {
    code: "hung-yen",
    name: "Hưng Yên",
    type: "Tỉnh",
    merged: ["Thái Bình"],
  },
  {
    code: "ninh-binh",
    name: "Ninh Bình",
    type: "Tỉnh",
    merged: ["Hà Nam", "Nam Định"],
  },
  {
    code: "quang-tri",
    name: "Quảng Trị",
    type: "Tỉnh",
    merged: ["Quảng Bình"],
  },
  {
    code: "quang-ngai",
    name: "Quảng Ngãi",
    type: "Tỉnh",
    merged: ["Kon Tum"],
  },
  {
    code: "gia-lai",
    name: "Gia Lai",
    type: "Tỉnh",
    merged: ["Bình Định"],
  },
  {
    code: "khanh-hoa",
    name: "Khánh Hòa",
    type: "Tỉnh",
    merged: ["Ninh Thuận"],
  },
  {
    code: "lam-dong",
    name: "Lâm Đồng",
    type: "Tỉnh",
    merged: ["Bình Thuận", "Đắk Nông"],
  },
  {
    code: "dak-lak",
    name: "Đắk Lắk",
    type: "Tỉnh",
    merged: ["Phú Yên"],
  },
  {
    code: "tay-ninh",
    name: "Tây Ninh",
    type: "Tỉnh",
    merged: ["Long An"],
  },
  {
    code: "dong-nai",
    name: "Đồng Nai",
    type: "Tỉnh",
    merged: ["Bình Phước"],
  },
  {
    code: "dong-thap",
    name: "Đồng Tháp",
    type: "Tỉnh",
    merged: ["Tiền Giang"],
  },
  {
    code: "an-giang",
    name: "An Giang",
    type: "Tỉnh",
    merged: ["Kiên Giang"],
  },
  {
    code: "vinh-long",
    name: "Vĩnh Long",
    type: "Tỉnh",
    merged: ["Trà Vinh", "Bến Tre"],
  },
  {
    code: "ca-mau",
    name: "Cà Mau",
    type: "Tỉnh",
    merged: ["Bạc Liêu"],
  },
];

/** Tổng số tỉnh/thành sau sáp nhập */
export const VN_PROVINCE_COUNT = VN_PROVINCES.length;

/** Default country cho Khách hàng + NCC mới */
export const DEFAULT_COUNTRY = "Việt Nam";

/**
 * Lookup province name từ code. Trả về null nếu không tìm thấy.
 */
export function getProvinceName(code: string | null | undefined): string | null {
  if (!code) return null;
  return VN_PROVINCES.find((p) => p.code === code)?.name ?? null;
}

/**
 * Lookup province code từ name (search bao gồm cả tên cũ đã sáp nhập).
 * Dùng cho Excel import: user nhập "Hải Dương" → resolve → code "hai-phong".
 */
export function findProvinceCode(name: string | null | undefined): string | null {
  if (!name) return null;
  const normalized = name.trim().toLowerCase();
  for (const p of VN_PROVINCES) {
    if (p.name.toLowerCase() === normalized) return p.code;
    if (p.name.toLowerCase().replace(/^tp\.\s*/, "") === normalized) return p.code;
    if (p.merged?.some((m) => m.toLowerCase() === normalized)) return p.code;
  }
  return null;
}

/**
 * Compose địa chỉ đầy đủ từ 5 trường structured. Skip field rỗng.
 * Output: "Số 123, Khu phố 5, Phường Bến Nghé, TP. Hồ Chí Minh, Việt Nam"
 */
export function composeAddress(parts: {
  houseNumber?: string | null;
  quarter?: string | null;
  ward?: string | null;
  province?: string | null;
  country?: string | null;
}): string {
  const chunks = [
    parts.houseNumber?.trim(),
    parts.quarter?.trim(),
    parts.ward?.trim(),
    parts.province?.trim(),
    parts.country?.trim(),
  ].filter((c): c is string => Boolean(c && c.length > 0));
  return chunks.join(", ");
}
