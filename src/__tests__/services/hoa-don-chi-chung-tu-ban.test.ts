import { describe, expect, it, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * TRANG HOÁ ĐƠN CHỈ HIỆN CHỨNG TỪ BÁN
 *
 * Lỗi được sửa (ảnh production 22/08/2026): màn /don-hang/hoa-don hiện cả
 * DH000057, DH000058 ở cột "Mã hóa đơn". Đơn đặt hàng thuộc trang Đơn đặt
 * hàng, kể cả khi đã xử lý xong.
 *
 * Sáu hình dạng dưới đây LẤY TỪ DỮ LIỆU PRODUCTION THẬT (preflight 22/08:
 * scripts/preflight-phan-loai-chung-tu-invoices.mjs), không phải bịa:
 *   A1 5 dòng · A2 5 dòng · A3 33 dòng · B1 5 · B2 12 · B3 273 (tổng 333).
 *
 * Điều tệ nhất có thể xảy ra ở đây KHÔNG phải là sót đơn đặt hàng, mà là LÀM
 * BIẾN MẤT 33 hoá đơn bán thật ở nhóm A3 (đơn cũ hoàn tất TẠI CHỖ: giữ
 * source='order' nhưng đã mang mã HD + order_code). Vì vậy nhóm A3 được khoá
 * bằng nhiều phép kiểm, kể cả phép kiểm chống hồi quy cú pháp lọc.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Mẫu dữ liệu — mỗi nhóm một dòng, giữ nguyên hình dạng cột thật
// ─────────────────────────────────────────────────────────────────────────────
const MAU = {
  A1_DH_chua_xu_ly: {
    code: "DH000059",
    source: "order",
    order_code: null,
    status: "draft",
    fulfilled_by_id: null,
    source_order_id: null,
  },
  A2_DH_da_xu_ly: {
    code: "DH000058",
    source: "order",
    order_code: null,
    status: "draft",
    fulfilled_by_id: "hd-001551",
    source_order_id: null,
  },
  A2_DH_da_huy: {
    code: "DH000004",
    source: "order",
    order_code: null,
    status: "cancelled",
    fulfilled_by_id: "hd-cu",
    source_order_id: null,
  },
  A3_HD_chuyen_tai_cho: {
    code: "HD001420",
    source: "order",
    order_code: "DH000001",
    status: "completed",
    fulfilled_by_id: null,
    source_order_id: null,
  },
  B1_HD_con: {
    code: "HD001549",
    source: "pos",
    order_code: "NH000161",
    status: "completed",
    fulfilled_by_id: null,
    source_order_id: "dh-000056",
  },
  B2_nhap_POS: {
    code: "NH000004",
    source: "pos",
    order_code: null,
    status: "cancelled",
    fulfilled_by_id: null,
    source_order_id: null,
  },
  B3_HD_ban_thang: {
    code: "HD000002",
    source: "pos",
    order_code: null,
    status: "completed",
    fulfilled_by_id: null,
    source_order_id: null,
  },
  // Nháp rất cũ: cột `source` còn NULL (xem chú thích ở listDraftOrders).
  B2_nhap_cu_source_NULL: {
    code: "NH000001",
    source: null,
    order_code: null,
    status: "draft",
    fulfilled_by_id: null,
    source_order_id: null,
  },
};

const { laChungTuBan, laDonDatHangConHieuLuc, LOC_CHUNG_TU_BAN } = await import(
  "@/lib/services/supabase/chung-tu-ban"
);

describe("Điều kiện dùng chung — sáu hình dạng chứng từ thật", () => {
  it("DH chưa xử lý: KHÔNG thuộc trang Hoá đơn", () => {
    expect(laChungTuBan(MAU.A1_DH_chua_xu_ly)).toBe(false);
    expect(laDonDatHangConHieuLuc(MAU.A1_DH_chua_xu_ly)).toBe(true);
  });

  it("DH đã gắn fulfilled_by_id: VẪN không thuộc trang Hoá đơn", () => {
    expect(laChungTuBan(MAU.A2_DH_da_xu_ly)).toBe(false);
  });

  it("DH đã huỷ: cũng không thuộc trang Hoá đơn", () => {
    expect(laChungTuBan(MAU.A2_DH_da_huy)).toBe(false);
  });

  it("HD lịch sử chuyển TẠI CHỖ: PHẢI còn (33 dòng production)", () => {
    expect(laChungTuBan(MAU.A3_HD_chuyen_tai_cho)).toBe(true);
  });

  it("HD con sinh từ đơn đặt hàng: thuộc trang Hoá đơn", () => {
    expect(laChungTuBan(MAU.B1_HD_con)).toBe(true);
  });

  it("Nháp POS NH: giữ nguyên hành vi cũ — vẫn hiện", () => {
    expect(laChungTuBan(MAU.B2_nhap_POS)).toBe(true);
  });

  it("HD bán thẳng: hiện", () => {
    expect(laChungTuBan(MAU.B3_HD_ban_thang)).toBe(true);
  });

  it("Nháp cũ source=NULL: hiện (không được rơi vì so sánh NULL)", () => {
    expect(laChungTuBan(MAU.B2_nhap_cu_source_NULL)).toBe(true);
  });

  it("order_code rỗng '' cũng coi là CHƯA chuyển mã", () => {
    expect(laChungTuBan({ source: "order", order_code: "" })).toBe(false);
  });

  it("đúng 3 nhóm bị ẩn / 5 nhóm được hiện trên bộ mẫu", () => {
    const tatCa = Object.values(MAU);
    expect(tatCa.filter(laChungTuBan)).toHaveLength(5);
    expect(tatCa.filter(laDonDatHangConHieuLuc)).toHaveLength(3);
  });
});

describe("Chống hồi quy: KHÔNG được rút gọn thành lọc ngây thơ", () => {
  it("lọc bằng source<>'order' sẽ làm MẤT hoá đơn chuyển tại chỗ", () => {
    // Đây là bản lọc SAI mà người sửa sau rất dễ viết ra. Ghi lại hậu quả để
    // ai đổi cũng thấy ngay vì sao không được làm vậy.
    const locNgayTho = (r: { source: string | null }) => r.source !== "order";
    expect(locNgayTho(MAU.A3_HD_chuyen_tai_cho)).toBe(false);
    expect(laChungTuBan(MAU.A3_HD_chuyen_tai_cho)).toBe(true);
  });

  it("lọc bằng tiền tố mã 'DH' sẽ bỏ sót/lọc nhầm khi quy ước mã đổi", () => {
    const locTienTo = (r: { code: string }) => !r.code.startsWith("DH");
    // Trùng kết quả hôm nay…
    expect(locTienTo(MAU.A2_DH_da_xu_ly)).toBe(laChungTuBan(MAU.A2_DH_da_xu_ly));
    // …nhưng sai ngay khi một đơn đặt hàng được cấp mã theo quy ước khác.
    const donMaKhac = { code: "DON-2026-01", source: "order", order_code: null };
    expect(locTienTo(donMaKhac)).toBe(true); // lọt vào trang Hoá đơn — SAI
    expect(laChungTuBan(donMaKhac)).toBe(false); // điều kiện thật: chặn đúng
  });

  it("chuỗi lọc PostgREST giữ đủ 3 vế, có vế NULL-an-toàn", () => {
    expect(LOC_CHUNG_TU_BAN.split(",")).toEqual([
      "source.is.null",
      "source.neq.order",
      "order_code.not.is.null",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getInvoices thật sự áp bộ lọc, và áp thành MỘT NHÓM RIÊNG
// ─────────────────────────────────────────────────────────────────────────────
const orCalls: string[] = [];

vi.mock("@/lib/services/supabase/base", () => {
  const chain = (): Record<string, unknown> => {
    const o: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "ilike", "in", "gte", "lt", "lte", "order", "range", "not"])
      o[m] = () => o;
    o.or = (dieuKien: string) => {
      orCalls.push(dieuKien);
      return o;
    };
    o.then = (giaiQuyet: (v: unknown) => void) =>
      giaiQuyet({ data: [], count: 0, error: null });
    return o;
  };
  return {
    getClient: () => ({ from: () => chain() }),
    handleError: (e: unknown) => {
      throw e;
    },
    getCurrentTenantId: async () => "tenant-1",
    getPaginationRange: () => ({ from: 0, to: 14 }),
  };
});

const { getInvoices } = await import("@/lib/services/supabase/invoices");

beforeEach(() => {
  orCalls.length = 0;
});

describe("getInvoices áp điều kiện ở tầng đọc", () => {
  it("luôn gửi bộ lọc chứng từ bán, kể cả khi không có bộ lọc nào khác", async () => {
    await getInvoices({ page: 0, pageSize: 15 });
    expect(orCalls).toContain(LOC_CHUNG_TU_BAN);
  });

  it("khi có tìm kiếm: là HAI nhóm or riêng (AND với nhau), không gộp một nhóm", async () => {
    await getInvoices({ page: 0, pageSize: 15, search: "DH000055" });
    // Gộp chung một chuỗi thì đơn đặt hàng lọt trở lại danh sách.
    expect(orCalls).toHaveLength(2);
    expect(orCalls[0]).toBe(LOC_CHUNG_TU_BAN);
    expect(orCalls[1]).toContain("code.ilike");
    expect(orCalls[0]).not.toContain("ilike");
  });

  it("tìm theo cột 'code': vẫn giữ nguyên nhóm lọc chứng từ", async () => {
    await getInvoices({ page: 0, pageSize: 15, search: "HD0014", searchField: "code" });
    expect(orCalls).toEqual([LOC_CHUNG_TU_BAN]);
  });

  it("lọc trạng thái + ngày + chi nhánh không làm mất bộ lọc", async () => {
    await getInvoices({
      page: 0,
      pageSize: 15,
      branchId: "cn-1",
      filters: { status: ["processing", "completed"], dateFrom: "2026-08-01", dateTo: "2026-08-31" },
    });
    expect(orCalls).toContain(LOC_CHUNG_TU_BAN);
  });

  it("bảng, tổng số và xuất Excel dùng CHUNG một truy vấn nên không thể lệch", async () => {
    // Trang Hoá đơn lấy `data` (bảng + Excel) và `total` (tổng số) từ CÙNG một
    // lần gọi getInvoices — khoá lại bằng hình dạng trả về.
    const kq = await getInvoices({ page: 0, pageSize: 15 });
    expect(Object.keys(kq).sort()).toEqual(["data", "total"]);
    expect(orCalls).toContain(LOC_CHUNG_TU_BAN);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// KPI (RPC 00342) phải mang ĐÚNG điều kiện của bảng
// ─────────────────────────────────────────────────────────────────────────────
describe("Migration 00342 giữ KPI khớp bảng", () => {
  const goc = join(process.cwd(), "supabase", "migrations");
  const sql = readFileSync(join(goc, "00342_invoice_list_only_sales_documents.sql"), "utf8");
  const hoanTac = readFileSync(
    join(goc, "00342_rollback_invoice_list_only_sales_documents.sql"),
    "utf8",
  );

  it("RPC KPI mang cùng mệnh đề lọc với bảng", () => {
    expect(sql).toContain("i.source IS DISTINCT FROM 'order' OR i.order_code IS NOT NULL");
  });

  it("dùng IS DISTINCT FROM — an toàn NULL, không phải <>", () => {
    // `i.source <> 'order'` trả NULL với dòng source NULL ⇒ LOẠI oan.
    expect(sql).not.toMatch(/i\.source\s*<>\s*'order'/);
  });

  it("không lọc bằng tiền tố mã", () => {
    expect(sql).not.toMatch(/i\.code\s+like\s+'DH/i);
  });

  it("giữ marker 00339 để không phá bản ngày hoá đơn", () => {
    expect(sql).toContain("ISSUED_AT_00335");
    expect(sql).toContain("CHUNG_TU_BAN_00342");
  });

  it("có guard chặn chạy trên nền chưa có 00339", () => {
    expect(sql).toMatch(/raise exception[\s\S]{0,300}ISSUED_AT_00335/i);
  });

  it("bảng chụp là BẤT BIẾN — on conflict do nothing, và hậu kiểm chặn chụp đè bản đã vá", () => {
    expect(sql).toContain("on conflict (migration, ham_oid) do nothing");
    expect(sql).toMatch(/position\('CHUNG_TU_BAN_00342' in def_truoc\)/);
  });

  it("hoàn tác chạy lại def_truoc và kiểm trùng khớp, không dựng tay", () => {
    expect(hoanTac).toContain("execute r.def_truoc");
    expect(hoanTac).toContain("is distinct from b.def_truoc");
    expect(hoanTac).not.toContain("CREATE OR REPLACE FUNCTION");
  });

  it("migration KHÔNG đụng dữ liệu", () => {
    const than = sql.replace(/--[^\n]*/g, ""); // bỏ chú thích
    expect(than).not.toMatch(/\bupdate\s+public\.invoices\b/i);
    expect(than).not.toMatch(/\bdelete\s+from\b/i);
    expect(than).not.toMatch(/\binsert\s+into\s+public\.invoices\b/i);
  });
});
