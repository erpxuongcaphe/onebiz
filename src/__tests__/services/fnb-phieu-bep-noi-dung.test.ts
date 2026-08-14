import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * KIỂM CHỨNG PHIẾU BẾP — dựng phiếu bằng ĐÚNG HÀM IN THẬT, dữ liệu giả.
 *
 * Vì sao cần: vòng trước (PR #146) chỉ QUÉT MÃ NGUỒN để chắc mọi nơi gọi in
 * đều truyền `modifierLabels`. Quét mã không chứng minh chữ có ra tới phiếu.
 * Tệp này dựng HTML thật rồi soi từng dòng, không tạo đơn, không gửi bếp.
 *
 * Hai tầng:
 *   A. buildKitchenTicketHtml — mẫu phiếu.
 *   B. printKitchenTicketsByStation — đường thật của POS (tách theo trạm).
 *      Đây là chỗ dữ liệu bị rơi mà tầng A không thấy được.
 */

import {
  buildKitchenTicketHtml,
  type KitchenTicketDataV2,
  type FnbPrintItem,
} from "@/lib/print-fnb";

const MON: FnbPrintItem = {
  name: "Trà sữa trân châu",
  variant: "Size L", // Size đi theo QUY CÁCH, không phải nhóm tuỳ chọn
  quantity: 2,
  unitPrice: 45_000,
  toppings: [{ name: "Trân châu trắng", quantity: 2, price: 8_000 }],
  modifierLabels: ["Mức đường: 50%", "Mức đá: Ít đá"],
  note: "Không ống hút",
};

const PHIEU: KitchenTicketDataV2 = {
  orderNumber: "BEP-TEST-001",
  tableName: "Bàn 5",
  orderType: "dine_in",
  items: [MON],
  createdAt: "2026-08-08T03:15:00.000Z",
  cashierName: "Nhân viên thử",
  style: "standard",
  paperSize: "80mm",
};

/** Vị trí xuất hiện; -1 nếu không có (để so thứ tự cho dễ đọc). */
function viTri(html: string, chuoi: string): number {
  return html.indexOf(chuoi);
}

describe("A. Mẫu phiếu bếp in đủ Size · Topping · Đường · Đá · ghi chú", () => {
  const html = buildKitchenTicketHtml(PHIEU);

  it("có đủ 5 phần, không thiếu phần nào", () => {
    expect(html).toContain("Trà sữa trân châu");
    expect(html, "Size (quy cách) phải in cạnh tên món").toContain("(Size L)");
    expect(html, "topping bán theo phần").toContain("Trân châu trắng x2");
    expect(html, "mức đường").toContain("Mức đường: 50%");
    expect(html, "mức đá").toContain("Mức đá: Ít đá");
    expect(html, "ghi chú từng món").toContain("Không ống hút");
  });

  it("đúng thứ tự: tên+Size → Topping → Đường/Đá → ghi chú", () => {
    const thuTu = [
      viTri(html, "Trà sữa trân châu"),
      viTri(html, "(Size L)"),
      viTri(html, "Trân châu trắng x2"),
      viTri(html, "Mức đường: 50%"),
      viTri(html, "Không ống hút"),
    ];
    expect(thuTu.every((v) => v >= 0)).toBe(true);
    expect(thuTu).toEqual([...thuTu].sort((a, b) => a - b));
  });

  it("Đường và Đá nằm chung MỘT dòng, ngăn bằng dấu chấm giữa", () => {
    expect(html).toContain("▸ Mức đường: 50% • Mức đá: Ít đá");
  });

  it("thiếu tuỳ chọn thì không in dòng rỗng", () => {
    const tron = buildKitchenTicketHtml({
      ...PHIEU,
      items: [{ name: "Cà phê đen", quantity: 1, unitPrice: 25_000 }],
    });
    expect(tron).not.toContain("▸");
    expect(tron).not.toContain("**");
  });

  it("kiểu Gọn vẫn in đủ thông tin pha chế, chỉ giảm mật độ trình bày", () => {
    const gon = buildKitchenTicketHtml({ ...PHIEU, style: "compact" });
    expect(gon).toContain("(Size L)");
    expect(gon).toContain("Trân châu trắng x2");
    expect(gon).toContain("Mức đường: 50%");
    expect(gon).toContain("Mức đá: Ít đá");
    expect(gon).toContain("Không ống hút");
    expect(gon).not.toContain('class="price"');
  });
});

describe("C. Cài đặt in mô tả đúng nội dung phiếu bếp", () => {
  it("không còn nói kiểu Gọn chỉ in tên món và số lượng", () => {
    const page = readFileSync(
      resolve(process.cwd(), "src/app/(main)/cai-dat/in-an/page.tsx"),
      "utf8",
    );

    expect(page).not.toContain("Chỉ tên món + số lượng");
    expect(page).toContain("Đủ thông tin pha chế, ít khoảng cách");
  });
});

// ── Tầng B: đường in THẬT của POS ────────────────────────────────────────

const phieuDaDung: string[] = [];

vi.mock("@/lib/services/supabase/kitchen-stations", () => ({
  // Món không gắn trạm → nhánh "no_station", đúng hiện trạng tenant chưa
  // chia trạm (backward compat trong print-stations.ts).
  getStationsByProductIds: async () => new Map<string, string | null>(),
  getKitchenStationsByBranch: async () => [],
}));

vi.mock("@/lib/print-fnb", async (importOriginal) => {
  const that = await importOriginal<typeof import("@/lib/print-fnb")>();
  return {
    ...that,
    // Giữ NGUYÊN mẫu dựng HTML thật, chỉ chặn bước mở cửa sổ in.
    printKitchenTicketV2: (data: KitchenTicketDataV2) => {
      phieuDaDung.push(that.buildKitchenTicketHtml(data));
    },
  };
});

const { printKitchenTicketsByStation } = await import(
  "@/app/pos/fnb/print-stations"
);

describe("B. Đường in thật của POS (tách theo trạm) giữ đủ tuỳ chọn", () => {
  beforeEach(() => {
    phieuDaDung.length = 0;
  });

  it("phiếu in ra từ POS có Size, Topping, Đường/Đá và ghi chú", async () => {
    const soPhieu = await printKitchenTicketsByStation(
      [
        {
          productId: "sp-1",
          productName: "Trà sữa trân châu",
          variantLabel: "Size L",
          quantity: 2,
          unitPrice: 45_000,
          toppings: [{ name: "Trân châu trắng", quantity: 2, price: 8_000 }],
          modifierLabels: ["Mức đường: 50%", "Mức đá: Ít đá"],
          note: "Không ống hút",
        },
      ],
      {
        orderNumber: "BEP-TEST-002",
        tableName: "Bàn 5",
        orderType: "dine_in",
        createdAt: "2026-08-08T03:15:00.000Z",
        style: "standard",
        paperSize: "80mm",
      },
      "chi-nhanh-gia",
    );

    expect(soPhieu).toBe(1);
    const html = phieuDaDung[0];
    expect(html).toContain("(Size L)");
    expect(html).toContain("Trân châu trắng x2");
    expect(
      html,
      "POS truyền modifierLabels nhưng bước tách trạm làm rơi -> bếp nhận phiếu giấy KHÔNG có Đường/Đá",
    ).toContain("Mức đường: 50%");
    expect(html).toContain("Mức đá: Ít đá");
    expect(html).toContain("Không ống hút");
  });
});
