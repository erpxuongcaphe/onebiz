/**
 * VietQR helper — chuẩn QR thanh toán liên ngân hàng VN (NAPAS).
 *
 * CEO 14/05/2026: build module Cài đặt thanh toán → auto-generate QR cho
 * mỗi đơn POS (FnB + Retail). Khách quét → app banking điền sẵn STK + số
 * tiền + nội dung → bấm chuyển → xong.
 *
 * Hai cách render QR:
 * 1. **Image URL** (recommend): `https://img.vietqr.io/image/<BIN>-<ACCOUNT>-compact2.png?amount=X&addInfo=Y&accountName=Z`
 *    - Public service của Vietcom — KHÔNG cần API key cho image
 *    - Static URL → cache được, in trên giấy / hiển thị POS
 * 2. **API JSON** (https://api.vietqr.io/v2/generate): cần CLIENT_ID + API_KEY
 *    → KHÔNG dùng vì cần subscription
 *
 * Tham khảo:
 * - https://vietqr.io/danh-sach-api
 * - https://api.vnpay.vn — chuẩn NAPAS247 (cùng spec với VietQR)
 *
 * BIN code (Bank Identification Number) — 6 chữ số cấp bởi NAPAS, BẮT BUỘC
 * có trong QR string. Em hardcode 30+ ngân hàng phổ biến nhất VN.
 */

export interface VietQrBank {
  /** Mã ngắn (vd "VCB", "TCB") — dùng làm key */
  code: string;
  /** BIN 6 chữ số NAPAS — bắt buộc cho QR string */
  bin: string;
  /** Tên đầy đủ VN */
  name: string;
  /** Tên viết tắt (vd "Vietcombank") */
  shortName: string;
  /** Logo URL (CDN VietQR) — optional */
  logo?: string;
}

/**
 * List ngân hàng VN hỗ trợ VietQR/NAPAS — sort theo % thị phần POS.
 * Source: https://api.vietqr.io/v2/banks (lấy snapshot tháng 5/2026).
 *
 * Top 15 đầu là NHTM lớn → đặt đầu list cho UX (user thường chọn).
 */
export const VIETQR_BANKS: VietQrBank[] = [
  // Top 4 NHTM nhà nước
  { code: "VCB", bin: "970436", name: "Ngân hàng TMCP Ngoại thương Việt Nam", shortName: "Vietcombank" },
  { code: "CTG", bin: "970415", name: "Ngân hàng TMCP Công thương Việt Nam", shortName: "VietinBank" },
  { code: "BIDV", bin: "970418", name: "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam", shortName: "BIDV" },
  { code: "AGRIBANK", bin: "970405", name: "Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam", shortName: "Agribank" },

  // Top NHTM cổ phần tư nhân
  { code: "TCB", bin: "970407", name: "Ngân hàng TMCP Kỹ thương Việt Nam", shortName: "Techcombank" },
  { code: "MB", bin: "970422", name: "Ngân hàng TMCP Quân đội", shortName: "MB Bank" },
  { code: "ACB", bin: "970416", name: "Ngân hàng TMCP Á Châu", shortName: "ACB" },
  { code: "VPB", bin: "970432", name: "Ngân hàng TMCP Việt Nam Thịnh Vượng", shortName: "VPBank" },
  { code: "TPB", bin: "970423", name: "Ngân hàng TMCP Tiên Phong", shortName: "TPBank" },
  { code: "STB", bin: "970403", name: "Ngân hàng TMCP Sài Gòn Thương Tín", shortName: "Sacombank" },
  { code: "HDB", bin: "970437", name: "Ngân hàng TMCP Phát triển TP.HCM", shortName: "HDBank" },
  { code: "VIB", bin: "970441", name: "Ngân hàng TMCP Quốc tế Việt Nam", shortName: "VIB" },
  { code: "SHB", bin: "970443", name: "Ngân hàng TMCP Sài Gòn - Hà Nội", shortName: "SHB" },
  { code: "OCB", bin: "970448", name: "Ngân hàng TMCP Phương Đông", shortName: "OCB" },
  { code: "MSB", bin: "970426", name: "Ngân hàng TMCP Hàng Hải", shortName: "MSB" },

  // NHTM cổ phần khác
  { code: "LPB", bin: "970449", name: "Ngân hàng TMCP Bưu điện Liên Việt", shortName: "LPBank" },
  { code: "SCB", bin: "970429", name: "Ngân hàng TMCP Sài Gòn", shortName: "SCB" },
  { code: "EIB", bin: "970431", name: "Ngân hàng TMCP Xuất Nhập khẩu Việt Nam", shortName: "Eximbank" },
  { code: "SEAB", bin: "970440", name: "Ngân hàng TMCP Đông Nam Á", shortName: "SeABank" },
  { code: "ABB", bin: "970425", name: "Ngân hàng TMCP An Bình", shortName: "ABBank" },
  { code: "NAB", bin: "970428", name: "Ngân hàng TMCP Nam Á", shortName: "Nam A Bank" },
  { code: "BAB", bin: "970409", name: "Ngân hàng TMCP Bắc Á", shortName: "BacABank" },
  { code: "PVCB", bin: "970412", name: "Ngân hàng TMCP Đại Chúng Việt Nam", shortName: "PVcomBank" },
  { code: "VAB", bin: "970427", name: "Ngân hàng TMCP Việt Á", shortName: "VietABank" },
  { code: "VIETBANK", bin: "970433", name: "Ngân hàng TMCP Việt Nam Thương Tín", shortName: "VietBank" },
  { code: "KLB", bin: "970452", name: "Ngân hàng TMCP Kiên Long", shortName: "KienLongBank" },
  { code: "BVB", bin: "970438", name: "Ngân hàng TMCP Bảo Việt", shortName: "BaoVietBank" },
  { code: "VCCB", bin: "970454", name: "Ngân hàng TMCP Bản Việt", shortName: "Viet Capital Bank" },
  { code: "DOB", bin: "970406", name: "Ngân hàng TMCP Đông Á", shortName: "DongA Bank" },
  { code: "PGB", bin: "970430", name: "Ngân hàng TMCP Xăng dầu Petrolimex", shortName: "PG Bank" },
  { code: "SGB", bin: "970400", name: "Ngân hàng TMCP Sài Gòn Công Thương", shortName: "Saigonbank" },

  // Ngân hàng số / digital banks
  { code: "CAKE", bin: "546034", name: "Ngân hàng số Cake by VPBank", shortName: "Cake by VPBank" },
  { code: "UBANK", bin: "546035", name: "Ngân hàng số Ubank by VPBank", shortName: "Ubank" },
  { code: "TIMO", bin: "963388", name: "Ngân hàng số Timo by Ban Viet Bank", shortName: "Timo" },
];

/**
 * Tìm bank theo code hoặc bin.
 */
export function findBank(codeOrBin: string): VietQrBank | undefined {
  return VIETQR_BANKS.find(
    (b) => b.code === codeOrBin || b.bin === codeOrBin,
  );
}

export interface BuildVietQrOptions {
  /** BIN 6 chữ số hoặc code ngắn (vd "970436" hoặc "VCB") */
  bank: string;
  /** Số tài khoản */
  accountNumber: string;
  /** Tên chủ TK — hiển thị trong app ngân hàng khi khách quét */
  accountHolder?: string;
  /** Số tiền VND (optional — nếu null user phải tự nhập trong app) */
  amount?: number;
  /** Nội dung chuyển khoản — nên dùng mã hoá đơn để đối soát (vd "HD000123") */
  addInfo?: string;
  /**
   * Template kiểu QR:
   * - compact   : QR vuông không text bên cạnh — đẹp, hợp khi in nhỏ
   * - compact2  : QR vuông + thông tin STK/tên + amount bên cạnh
   * - print     : QR + text in trên giấy nhiệt (POS receipt) — recommend
   * - qr_only   : chỉ QR (no border, no text)
   * Default 'compact2' (hiển thị web preview).
   */
  template?: "compact" | "compact2" | "print" | "qr_only";
}

/**
 * Build VietQR image URL — public CDN của VietQR.io, KHÔNG cần API key.
 *
 * Form return URL trả PNG image có thể nhúng vào <img> hoặc print directly.
 *
 * @example
 *   buildVietQrUrl({
 *     bank: "VCB",
 *     accountNumber: "0123456789",
 *     accountHolder: "NGUYEN VAN A",
 *     amount: 250000,
 *     addInfo: "HD000123 thanh toan",
 *     template: "print"
 *   })
 *   // → https://img.vietqr.io/image/970436-0123456789-print.png?amount=250000&addInfo=HD000123+thanh+toan&accountName=NGUYEN+VAN+A
 */
export function buildVietQrUrl(opts: BuildVietQrOptions): string {
  const bank = findBank(opts.bank);
  if (!bank) {
    throw new Error(`Bank not supported: ${opts.bank}`);
  }
  const template = opts.template ?? "compact2";
  const base = `https://img.vietqr.io/image/${bank.bin}-${opts.accountNumber}-${template}.png`;
  const params = new URLSearchParams();
  if (opts.amount != null && opts.amount > 0) {
    params.set("amount", String(Math.round(opts.amount)));
  }
  if (opts.addInfo) {
    // Tránh ký tự đặc biệt — VietQR chỉ chấp nhận chữ Latin + số + space + dash
    const cleaned = opts.addInfo
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // strip diacritics
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .trim()
      .slice(0, 50);
    params.set("addInfo", cleaned);
  }
  if (opts.accountHolder) {
    const cleaned = opts.accountHolder
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, "")
      .trim()
      .slice(0, 50);
    params.set("accountName", cleaned);
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/**
 * Validate VN bank account number — chỉ check basic format:
 * - 4-20 chữ số
 * - Không space/letter
 *
 * Không check checksum/IBAN vì VN account number không có chuẩn IBAN.
 */
export function isValidAccountNumber(account: string): boolean {
  return /^\d{4,20}$/.test(account.trim());
}
