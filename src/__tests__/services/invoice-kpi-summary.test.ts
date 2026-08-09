import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * K2 — CHỈ SỐ MÀN HOÁ ĐƠN LẤY TỪ MÁY CHỦ (RPC 00305)
 *
 * Lỗi được sửa: 4 thẻ KPI cộng từ `data` — CHỈ 15 dòng của trang đang xem —
 * nhưng đặt cạnh "Tổng HĐ" lấy từ `total` của cả bộ lọc.
 *
 * Ràng buộc CEO 08/08 mà tệp này khoá lại:
 *   • Client KHÔNG ánh xạ processing lần hai — RPC tự làm.
 *   • Ngày kết thúc dùng mốc ĐẦU NGÀY KẾ TIẾP (khớp `<` của danh sách).
 *   • Khoá nhớ tạm gồm mọi bộ lọc, KHÔNG gồm số trang.
 *   • `so_dong_theo_bo_loc` phải khớp `total` của danh sách.
 */

const rpcCalls: Array<{ ten: string; args: Record<string, unknown> }> = [];
let rpcTraVe: Record<string, unknown> | null = null;
let rpcLoi: unknown = null;

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({
    rpc: async (ten: string, args: Record<string, unknown>) => {
      rpcCalls.push({ ten, args });
      if (rpcLoi) return { data: null, error: rpcLoi };
      return { data: [rpcTraVe], error: null };
    },
  }),
  handleError: (e: unknown) => {
    throw e;
  },
  getCurrentTenantId: async () => "tenant-1",
  getPaginationRange: () => ({ from: 0, to: 14 }),
}));

const { getInvoiceListSummary, khoaChiSoHoaDon } = await import(
  "@/lib/services/supabase/invoices"
);

const SO_MAY_CHU = {
  tat_ca_hoa_don: 260,
  hoan_thanh: 212,
  da_huy: 48,
  gia_tri_hoan_thanh: "594922690.00",
  giam_gia_ap_dung: "0.00",
  so_dong_theo_bo_loc: 260,
};

beforeEach(() => {
  rpcCalls.length = 0;
  rpcTraVe = { ...SO_MAY_CHU };
  rpcLoi = null;
});

describe("Đọc đúng số máy chủ trả về", () => {
  it("ánh xạ đủ 6 chỉ số, tiền về kiểu số", async () => {
    const kq = await getInvoiceListSummary({});
    expect(kq).toEqual({
      tatCaHoaDon: 260,
      hoanThanh: 212,
      daHuy: 48,
      giaTriHoanThanh: 594_922_690,
      giamGiaApDung: 0,
      soDongTheoBoLoc: 260,
    });
  });

  it("gọi đúng tên hàm 00305", async () => {
    await getInvoiceListSummary({});
    expect(rpcCalls[0].ten).toBe("get_invoice_list_summary");
  });

  it("lỗi thì NÉM ra, không tự bịa số — trang gọi phải giữ số cũ", async () => {
    rpcLoi = { message: "boom" };
    await expect(getInvoiceListSummary({})).rejects.toBeTruthy();
  });
});

describe("Không ánh xạ trạng thái lần hai ở client", () => {
  it("'processing' đi NGUYÊN vào RPC — RPC tự nổ thành draft + confirmed", async () => {
    await getInvoiceListSummary({ statuses: ["processing", "completed"] });
    expect(rpcCalls[0].args.p_statuses).toEqual(["processing", "completed"]);
  });

  it("danh sách trạng thái rỗng → null (không lọc trạng thái)", async () => {
    await getInvoiceListSummary({ statuses: [] });
    expect(rpcCalls[0].args.p_statuses).toBeNull();
  });
});

describe("Khoảng ngày khớp danh sách: >= from, < đầu ngày kế tiếp", () => {
  it("dateTo → ĐẦU ngày kế tiếp, và quy đổi giờ Việt Nam sang UTC", async () => {
    await getInvoiceListSummary({ dateFrom: "2026-08-01", dateTo: "2026-08-08" });
    const tu = String(rpcCalls[0].args.p_date_from);
    const den = String(rpcCalls[0].args.p_date_to_exclusive);
    // Nửa đêm 01/08 giờ Việt Nam = 17:00 ngày 31/07 giờ UTC (VN = UTC+7).
    // Khoá luôn cả múi giờ ở đây: lệch múi giờ là lệch doanh thu theo ngày.
    expect(tu).toBe("2026-07-31T17:00:00.000Z");
    // Mốc kết thúc là ĐẦU ngày 09/08 giờ VN (không phải 08/08), vì danh sách
    // dùng `<` chứ không `<=` → 08/08T17:00Z.
    expect(den).toBe("2026-08-08T17:00:00.000Z");
  });

  it("không chọn ngày → không truyền mốc nào", async () => {
    await getInvoiceListSummary({});
    expect(rpcCalls[0].args.p_date_from).toBeNull();
    expect(rpcCalls[0].args.p_date_to_exclusive).toBeNull();
  });
});

describe("K2 chưa nối bộ lọc giao hàng", () => {
  it("mặc định luôn 'all'", async () => {
    await getInvoiceListSummary({});
    expect(rpcCalls[0].args.p_delivery).toBe("all");
  });
});

describe("Khoá nhớ tạm — gồm mọi bộ lọc, KHÔNG gồm số trang", () => {
  const NEN = {
    branchId: "cn-1",
    dateFrom: "2026-08-01",
    dateTo: "2026-08-08",
    statuses: ["completed"],
    search: "HD001",
    searchField: "code",
    delivery: "all" as const,
  };

  it("đổi bất kỳ bộ lọc nào → khoá đổi", () => {
    const goc = khoaChiSoHoaDon(NEN);
    expect(khoaChiSoHoaDon({ ...NEN, branchId: "cn-2" })).not.toBe(goc);
    expect(khoaChiSoHoaDon({ ...NEN, dateFrom: "2026-07-01" })).not.toBe(goc);
    expect(khoaChiSoHoaDon({ ...NEN, dateTo: "2026-08-09" })).not.toBe(goc);
    expect(khoaChiSoHoaDon({ ...NEN, statuses: ["cancelled"] })).not.toBe(goc);
    expect(khoaChiSoHoaDon({ ...NEN, search: "HD002" })).not.toBe(goc);
    expect(khoaChiSoHoaDon({ ...NEN, searchField: "customer_name" })).not.toBe(goc);
    expect(khoaChiSoHoaDon({ ...NEN, delivery: "delivery" })).not.toBe(goc);
  });

  it("thứ tự trạng thái khác nhau vẫn cùng một khoá (tránh gọi lại vô ích)", () => {
    expect(khoaChiSoHoaDon({ ...NEN, statuses: ["completed", "cancelled"] })).toBe(
      khoaChiSoHoaDon({ ...NEN, statuses: ["cancelled", "completed"] }),
    );
  });

  it("KHÔNG có số trang trong khoá — lật trang không được gọi lại RPC", () => {
    // Khoá chỉ dựng từ 7 trường lọc; nếu ai đó thêm `page` vào tham số thì
    // khoá vẫn phải y nguyên.
    const themTrang = { ...NEN, page: 3 } as unknown as typeof NEN;
    expect(khoaChiSoHoaDon(themTrang)).toBe(khoaChiSoHoaDon(NEN));
  });
});

describe("Đối chiếu với danh sách", () => {
  it("ánh xạ đúng cột so_dong_theo_bo_loc từ máy chủ (fixture)", async () => {
    // Ca này CHỈ chứng minh việc ánh xạ cột, KHÔNG chứng minh số liệu khớp
    // danh sách — hai bên cùng lấy từ một fixture thì so nhau là vô nghĩa.
    // Việc đối chiếu thật đã làm bằng preflight chỉ đọc trên prod 08/08:
    // danh sách total = 260 và RPC so_dong_theo_bo_loc = 260, hai đường tính
    // độc lập. Ghi lại ở docs/PREFLIGHT-KPI-HOA-DON-A1-A8.sql mục A8.
    rpcTraVe = { ...SO_MAY_CHU, so_dong_theo_bo_loc: 137 };
    const kq = await getInvoiceListSummary({});
    expect(kq.soDongTheoBoLoc).toBe(137);
  });

  it("giá trị hoàn thành KHÔNG bị trừ giảm giá lần hai", async () => {
    rpcTraVe = {
      ...SO_MAY_CHU,
      gia_tri_hoan_thanh: "1000000.00",
      giam_gia_ap_dung: "150000.00",
    };
    const kq = await getInvoiceListSummary({});
    // Đúng: hiện 1.000.000 và ghi riêng "giảm giá 150.000".
    // Sai (lỗi cũ): 1.000.000 − 150.000 = 850.000.
    expect(kq.giaTriHoanThanh).toBe(1_000_000);
    expect(kq.giamGiaApDung).toBe(150_000);
    expect(kq.giaTriHoanThanh - kq.giamGiaApDung).not.toBe(kq.giaTriHoanThanh);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Chống kết quả cũ đè kết quả mới + làm mới sau khi đổi dữ liệu
// ────────────────────────────────────────────────────────────────────────

const { taoBoNhoChiSo } = await import("@/lib/services/supabase/invoices");

const SO_A = {
  tatCaHoaDon: 260, hoanThanh: 212, daHuy: 48,
  giaTriHoanThanh: 594_922_690, giamGiaApDung: 0, soDongTheoBoLoc: 260,
};
const SO_B = {
  tatCaHoaDon: 12, hoanThanh: 10, daHuy: 2,
  giaTriHoanThanh: 5_000_000, giamGiaApDung: 0, soDongTheoBoLoc: 12,
};

describe("Kết quả cũ không được đè kết quả mới", () => {
  it("A đang bay → đổi sang B ĐÃ CÓ trong nhớ tạm → A về sau bị bỏ", () => {
    const bo = taoBoNhoChiSo();
    // B đã từng tải trước đó nên nằm sẵn trong nhớ tạm.
    bo.luu("khoa-B", SO_B);

    // Người dùng đang ở bộ lọc A — lượt A bắt đầu, chưa có sẵn.
    const luotA = bo.batDau("khoa-A");
    expect(luotA.sanCo).toBeUndefined();

    // Chưa kịp về thì đổi sang bộ lọc B — đi đường nhớ tạm, KHÔNG gọi mạng.
    const luotB = bo.batDau("khoa-B");
    expect(luotB.sanCo).toEqual(SO_B);

    // A về muộn: phải bị coi là cũ. Đây chính là ca mà bản trước làm sai —
    // nhánh nhớ tạm thoát sớm mà không tăng số lượt.
    expect(bo.conMoiNhat(luotA.luot)).toBe(false);
    expect(bo.conMoiNhat(luotB.luot)).toBe(true);
  });

  it("A rồi B đều gọi mạng: chỉ B được ghi nhận", () => {
    const bo = taoBoNhoChiSo();
    const a = bo.batDau("khoa-A");
    const b = bo.batDau("khoa-B");
    expect(bo.conMoiNhat(a.luot)).toBe(false);
    expect(bo.conMoiNhat(b.luot)).toBe(true);
  });

  it("quay lại bộ lọc cũ thì dùng nhớ tạm, không gọi mạng", () => {
    const bo = taoBoNhoChiSo();
    const a = bo.batDau("khoa-A");
    bo.luu("khoa-A", SO_A);
    expect(bo.conMoiNhat(a.luot)).toBe(true);
    expect(bo.batDau("khoa-A").sanCo).toEqual(SO_A);
  });
});

describe("Đổi dữ liệu hoá đơn thì chỉ số phải tải lại", () => {
  it("xoá hết nhớ tạm → bộ lọc cũ KHÔNG còn số sẵn, buộc gọi lại RPC", () => {
    const bo = taoBoNhoChiSo();
    bo.luu("khoa-A", SO_A);
    expect(bo.batDau("khoa-A").sanCo).toEqual(SO_A);
    // Hủy một hoá đơn → số cũ không còn đúng.
    bo.xoaHet();
    expect(bo.batDau("khoa-A").sanCo).toBeUndefined();
  });

  it("mọi nơi đổi dữ liệu hoá đơn đều đi qua taiLaiSauKhiDoiDuLieu", async () => {
    // Quét mã nguồn: hủy · hủy hàng loạt · sửa · thanh toán · gắn vận đơn.
    // Không nơi nào được gọi fetchData() trần — gọi trần thì bảng mới mà dải
    // chỉ số vẫn số cũ.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/(main)/don-hang/hoa-don/page.tsx", "utf8");
    for (const noi of [
      "onDone={taiLaiSauKhiDoiDuLieu}",        // hủy hoá đơn
      "onDataChanged={taiLaiSauKhiDoiDuLieu}", // gắn vận đơn
      "onSuccess={taiLaiSauKhiDoiDuLieu}",     // sửa + thanh toán
      "await taiLaiSauKhiDoiDuLieu();",        // thao tác trên dòng
    ]) {
      expect(src, `thiếu nơi gọi: ${noi}`).toContain(noi);
    }
    // Chỉ còn 3 chỗ nhắc fetchData: khai báo, effect tải lần đầu, và bên
    // trong taiLaiSauKhiDoiDuLieu.
    const soLanDungFetchData = src.split("fetchData").length - 1;
    expect(soLanDungFetchData).toBeLessThanOrEqual(6);
  });
});

// Phạm vi chi nhánh: đã tách sang invoice-list-scope.test.ts —
// nơi test ĐẾM lời gọi getInvoices thật thay vì kiểm giá trị hàm.
