/**
 * ESC/POS Command Encoder
 * ------------------------------------------------------------
 * Build byte arrays tuân theo chuẩn ESC/POS — tương thích đa
 * số máy in nhiệt 58mm / 80mm phổ biến ở VN:
 *   - Xprinter (XP-58, XP-80, XP-T260, XP-Q200 ...)
 *   - Epson TM-T20 / TM-T82 / TM-T88
 *   - Sunmi V1/V2 (built-in printer)
 *   - Gprinter, Bixolon, Rongta, Zjiang ...
 *
 * Output: Uint8Array — pipe qua WebUSB `transferOut()` hoặc
 * WebBluetooth `characteristic.writeValue()`.
 *
 * Lý do không dùng thư viện npm:
 *   1. `node-escpos` / `escpos` phụ thuộc Node Buffer → không chạy browser
 *   2. `escpos-printer` bundle to và thừa feature
 *   3. Mình chỉ cần ~10 command cơ bản — tự viết 300 dòng là đủ
 */

// ─── ESC/POS raw commands ───
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
const CR = 0x0d;

// ─── Style enum ───
export type Align = "left" | "center" | "right";
export type TextSize = "normal" | "double" | "large";
export type TextStyle = {
  bold?: boolean;
  underline?: boolean;
  align?: Align;
  size?: TextSize;
};

// ─── Paper widths (ký tự/dòng) ───
export const PAPER_COLS = {
  "58mm": 32, // 32 cột font A (12×24)
  "80mm": 48, // 48 cột font A (12×24)
} as const;

export type PaperWidth = keyof typeof PAPER_COLS;

// ──────────────────────────────────────────────────────
// Builder — tích luỹ byte qua chuỗi method rồi .build()
// ──────────────────────────────────────────────────────

export class EscPosBuilder {
  private bytes: number[] = [];
  private width: number;

  constructor(paperWidth: PaperWidth = "80mm") {
    this.width = PAPER_COLS[paperWidth];
    this.init();
  }

  /** ESC @ — reset máy in (xoá mode, margin, font) */
  init(): this {
    this.bytes.push(ESC, 0x40);
    return this;
  }

  /** Set codepage — dùng CP858 để in được ký tự Tây Âu.
   *  Tiếng Việt có dấu: encode qua removeDiacritics (khả dụng với mọi máy in)
   *  hoặc dùng VISCII (ít máy support). Mặc định mình strip dấu cho an toàn. */
  private setCodepageCP858(): this {
    // ESC t n — select character code table
    // n=19 → CP858 (bao gồm € và 1 số ký tự Tây Âu)
    this.bytes.push(ESC, 0x74, 19);
    return this;
  }

  // ── Text styling ──

  align(a: Align): this {
    const n = a === "center" ? 1 : a === "right" ? 2 : 0;
    this.bytes.push(ESC, 0x61, n);
    return this;
  }

  bold(on: boolean): this {
    this.bytes.push(ESC, 0x45, on ? 1 : 0);
    return this;
  }

  underline(level: 0 | 1 | 2): this {
    this.bytes.push(ESC, 0x2d, level);
    return this;
  }

  /** Size: normal | double (gấp đôi) | large (gấp 3 cao + 2 rộng) */
  size(s: TextSize): this {
    let n = 0;
    if (s === "double") n = 0x11; // width×2, height×2
    else if (s === "large") n = 0x22; // width×3, height×3 (max)
    this.bytes.push(GS, 0x21, n);
    return this;
  }

  // ── Text output ──

  /** In 1 đoạn text với style + xuống dòng */
  text(str: string, style: TextStyle = {}): this {
    if (style.align) this.align(style.align);
    if (style.bold !== undefined) this.bold(style.bold);
    if (style.underline !== undefined) this.underline(style.underline ? 1 : 0);
    if (style.size) this.size(style.size);

    // Convert string → bytes
    // Strategy: strip Vietnamese diacritics cho tương thích máy in không support UTF-8
    const stripped = stripDiacritics(str);
    for (let i = 0; i < stripped.length; i++) {
      const code = stripped.charCodeAt(i);
      // Chỉ gửi byte ASCII/extended — drop ký tự > 255
      this.bytes.push(code <= 0xff ? code : 0x3f); // '?' fallback
    }
    this.bytes.push(LF);

    // Reset styles sau mỗi line để không lẫn
    if (style.bold) this.bold(false);
    if (style.underline) this.underline(0);
    if (style.size && style.size !== "normal") this.size("normal");
    if (style.align && style.align !== "left") this.align("left");
    return this;
  }

  /** In dòng không xuống dòng (để ghép nhiều style trong 1 line) */
  textRaw(str: string, style: TextStyle = {}): this {
    if (style.align) this.align(style.align);
    if (style.bold !== undefined) this.bold(style.bold);
    if (style.size) this.size(style.size);

    const stripped = stripDiacritics(str);
    for (let i = 0; i < stripped.length; i++) {
      const code = stripped.charCodeAt(i);
      this.bytes.push(code <= 0xff ? code : 0x3f);
    }
    return this;
  }

  newline(n: number = 1): this {
    for (let i = 0; i < n; i++) this.bytes.push(LF);
    return this;
  }

  /** Kẻ 1 đường ngang bằng dấu "-" theo chiều rộng giấy */
  divider(char: string = "-"): this {
    return this.text(char.repeat(this.width));
  }

  /** 2 cột: left + right (right sát mép phải)
   *  VD: textTwoColumns("Cà phê đen x2", "40.000")
   *  → "Ca phe den x2              40.000" */
  textTwoColumns(left: string, right: string, style: TextStyle = {}): this {
    const leftStripped = stripDiacritics(left);
    const rightStripped = stripDiacritics(right);
    const space = Math.max(1, this.width - leftStripped.length - rightStripped.length);
    return this.text(leftStripped + " ".repeat(space) + rightStripped, style);
  }

  /** 3 cột cho bảng item: name | qty×price | total */
  textThreeColumns(
    col1: string,
    col2: string,
    col3: string,
    widths: [number, number, number] = [this.width - 16, 8, 8]
  ): this {
    const pad = (s: string, w: number, align: Align = "left"): string => {
      s = stripDiacritics(s);
      if (s.length > w) s = s.slice(0, w);
      const diff = w - s.length;
      if (diff <= 0) return s;
      if (align === "right") return " ".repeat(diff) + s;
      if (align === "center")
        return " ".repeat(Math.floor(diff / 2)) + s + " ".repeat(Math.ceil(diff / 2));
      return s + " ".repeat(diff);
    };
    return this.text(pad(col1, widths[0]) + pad(col2, widths[1], "right") + pad(col3, widths[2], "right"));
  }

  // ── Hardware commands ──

  /** Cắt giấy (partial cut) — máy không support cut sẽ ignore */
  cut(full: boolean = false): this {
    // GS V m — cut paper; m=0 full, m=1 partial
    this.bytes.push(GS, 0x56, full ? 0 : 1);
    return this;
  }

  /** Mở ngăn kéo tiền (cash drawer) — pulse pin 2 hoặc 5 */
  openDrawer(pin: 2 | 5 = 2): this {
    // ESC p m t1 t2 — generate pulse
    // m=0 → pin 2, m=1 → pin 5
    this.bytes.push(ESC, 0x70, pin === 2 ? 0 : 1, 50, 50);
    return this;
  }

  /** Đẩy giấy n dòng + feed (GS V B n — cut + feed) */
  feed(lines: number = 3): this {
    for (let i = 0; i < lines; i++) this.bytes.push(LF);
    return this;
  }

  /** Beep — máy có buzzer sẽ kêu */
  beep(times: number = 1, duration: number = 3): this {
    // ESC B n t — beep n times, t × 100ms duration
    this.bytes.push(ESC, 0x42, times, duration);
    return this;
  }

  // ── Barcode / QR (tuỳ máy — best-effort) ──

  /** In QR code — dùng GS ( k (some máy mới hỗ trợ) */
  qrcode(data: string, size: number = 6): this {
    const bytes = data.split("").map((c) => c.charCodeAt(0));
    // Model
    this.bytes.push(GS, 0x28, 0x6b, 4, 0, 49, 65, 50, 0);
    // Size 1-16
    const s = Math.max(1, Math.min(16, size));
    this.bytes.push(GS, 0x28, 0x6b, 3, 0, 49, 67, s);
    // Error correction L=48 M=49 Q=50 H=51
    this.bytes.push(GS, 0x28, 0x6b, 3, 0, 49, 69, 48);
    // Store data
    const len = bytes.length + 3;
    this.bytes.push(GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 49, 80, 48);
    this.bytes.push(...bytes);
    // Print
    this.bytes.push(GS, 0x28, 0x6b, 3, 0, 49, 81, 48);
    return this;
  }

  // ── Build ──

  build(): Uint8Array {
    this.feed(3).cut(false);
    return new Uint8Array(this.bytes);
  }

  /** Build raw (không feed/cut cuối) — dùng cho ticket ghép nhiều bản */
  buildRaw(): Uint8Array {
    return new Uint8Array(this.bytes);
  }

  getWidth(): number {
    return this.width;
  }
}

// ──────────────────────────────────────────────────────
// Diacritic stripping — VN unicode → ASCII
// ──────────────────────────────────────────────────────

/**
 * Bỏ dấu tiếng Việt. Dùng NFD + regex range U+0300-U+036F để
 * strip combining marks — đơn giản, không cần bảng map.
 * Các chữ Đ/đ không decompose → xử lý riêng.
 */
export function stripDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}
