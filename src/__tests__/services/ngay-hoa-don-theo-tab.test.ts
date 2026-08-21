import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  chuyenTab,
  themTab,
  dongTab,
  doiChiNhanh,
  type TabHoaDon,
} from "../../app/pos/lib/pos-tab-transitions";

/**
 * 00335 — NGÀY HÓA ĐƠN PHẢI THUỘC RIÊNG TỪNG TAB.
 *
 * LỖI THẬT ĐANG VÁ: `ngayHoaDon`/`lyDoNgayHoaDon` là state TOÀN TRANG, nên thu
 * ngân chỉnh ngày ở tab A rồi bấm sang tab B là hóa đơn B lĩnh luôn ngày đó —
 * ghi sai kỳ kế toán, không phải lỗi trình bày.
 *
 * Đây là test HÀNH VI: dựng tab thật, chạy đúng phép biến đổi mà trang gọi,
 * đọc kết quả. Không quét chuỗi mã (trừ đúng một ca cuối, xem chú thích ở đó).
 */

const NGAY_A = "2026-08-17T06:12:00.000Z";
const NGAY_C = "2026-08-05T02:00:00.000Z";

function tab(id: string, thua: Partial<TabHoaDon> = {}): TabHoaDon {
  return {
    id,
    snapshot: null,
    itemCount: 0,
    sessionId: "sess-" + id,
    ngayHoaDon: null,
    lyDoNgayHoaDon: "",
    ...thua,
  };
}

/** Tab đang hoạt động rời đi mang theo giỏ + ngày đang hiện trên màn. */
function diRa(ngay: string | null, lyDo = "", itemCount = 0) {
  return {
    snapshot: { gio: "A" },
    itemCount,
    ngayHoaDon: ngay,
    lyDoNgayHoaDon: lyDo,
  };
}

describe("Ngày hóa đơn theo từng tab — chuyển tab", () => {
  it("A chỉnh ngày rồi sang B: B KHÔNG bị lây, vẫn tự động", () => {
    const tabs = [tab("A"), tab("B")];

    const kq = chuyenTab(tabs, "A", "B", diRa(NGAY_A, "Máy treo", 3));

    expect(kq).not.toBeNull();
    expect(kq!.tabHoatDong).toBe("B");
    // Điểm mấu chốt: tab đi vào giữ ngày CỦA CHÍNH NÓ.
    expect(kq!.ngayHoaDon).toBeNull();
    expect(kq!.lyDoNgayHoaDon).toBe("");
  });

  it("ngày đã chỉnh của A được cất lại, quay về A là thấy nguyên", () => {
    const tabs = [tab("A"), tab("B")];

    const sangB = chuyenTab(tabs, "A", "B", diRa(NGAY_A, "Máy treo", 3))!;
    // A nằm trong danh sách với đúng ngày + lý do đã cất.
    const aDaCat = sangB.tabs.find((t) => t.id === "A")!;
    expect(aDaCat.ngayHoaDon).toBe(NGAY_A);
    expect(aDaCat.lyDoNgayHoaDon).toBe("Máy treo");

    const veA = chuyenTab(sangB.tabs, "B", "A", diRa(null, ""))!;
    expect(veA.ngayHoaDon).toBe(NGAY_A);
    expect(veA.lyDoNgayHoaDon).toBe("Máy treo");
  });

  it("giỏ hàng và ngày đi CÙNG NHAU, không lệch tab", () => {
    const tabs = [tab("A"), tab("B", { snapshot: { gio: "B" }, ngayHoaDon: NGAY_C })];

    const kq = chuyenTab(tabs, "A", "B", diRa(NGAY_A, "Máy treo", 3))!;

    expect(kq.snapshotVao).toEqual({ gio: "B" });
    expect(kq.ngayHoaDon).toBe(NGAY_C);
    // Và giỏ của A cũng được cất cùng ngày của A.
    const aDaCat = kq.tabs.find((t) => t.id === "A")!;
    expect(aDaCat.snapshot).toEqual({ gio: "A" });
    expect(aDaCat.itemCount).toBe(3);
    expect(aDaCat.ngayHoaDon).toBe(NGAY_A);
  });

  it("bấm đúng tab đang mở hoặc id lạ: không làm gì (giữ nguyên giỏ)", () => {
    const tabs = [tab("A"), tab("B")];
    expect(chuyenTab(tabs, "A", "A", diRa(NGAY_A, "Máy treo"))).toBeNull();
    expect(chuyenTab(tabs, "A", "KHONG-CO", diRa(NGAY_A, "Máy treo"))).toBeNull();
  });
});

describe("Ngày hóa đơn theo từng tab — mở tab mới", () => {
  it("tab mới LUÔN tự động dù tab hiện tại đang chỉnh tay", () => {
    const tabs = [tab("A")];

    const kq = themTab(tabs, "A", diRa(NGAY_A, "Máy treo", 2), tab("C"));

    expect(kq.tabHoatDong).toBe("C");
    expect(kq.ngayHoaDon).toBeNull();
    expect(kq.lyDoNgayHoaDon).toBe("");
    expect(kq.snapshotVao).toBeNull();
    // A vẫn giữ ngày của mình.
    expect(kq.tabs.find((t) => t.id === "A")!.ngayHoaDon).toBe(NGAY_A);
  });

  it("tab mới truyền vào có sẵn ngày vẫn bị ép về tự động", () => {
    // Chặn kiểu lỗi 'copy tab': dựng tab mới từ tab cũ mà quên xoá ngày.
    const kq = themTab([tab("A")], "A", diRa(null, ""), tab("C", { ngayHoaDon: NGAY_C, lyDoNgayHoaDon: "chép nhầm" }));
    expect(kq.tabs.find((t) => t.id === "C")!.ngayHoaDon).toBeNull();
    expect(kq.ngayHoaDon).toBeNull();
  });
});

describe("Ngày hóa đơn theo từng tab — đóng tab", () => {
  it("đóng tab đang hoạt động: tab kế nhiệm mang ngày CỦA CHÍNH NÓ", () => {
    const tabs = [
      tab("A"),
      tab("B", { ngayHoaDon: NGAY_C, lyDoNgayHoaDon: "bán bù hôm 5", snapshot: { gio: "B" } }),
    ];

    const kq = dongTab(tabs, "A", "A")!;

    expect(kq.doiTabHoatDong).toBe(true);
    expect(kq.tabHoatDong).toBe("B");
    expect(kq.ngayHoaDon).toBe(NGAY_C);
    expect(kq.lyDoNgayHoaDon).toBe("bán bù hôm 5");
    expect(kq.snapshotVao).toEqual({ gio: "B" });
    expect(kq.tabs.map((t) => t.id)).toEqual(["B"]);
  });

  it("đóng tab KHÔNG hoạt động: không đổi tab, không đụng ngày đang dùng", () => {
    const tabs = [tab("A"), tab("B", { ngayHoaDon: NGAY_C })];

    const kq = dongTab(tabs, "B", "A")!;

    expect(kq.doiTabHoatDong).toBe(false);
    expect(kq.tabHoatDong).toBe("A");
    expect(kq.tabs.map((t) => t.id)).toEqual(["A"]);
  });

  it("không cho đóng tab cuối cùng", () => {
    expect(dongTab([tab("A")], "A", "A")).toBeNull();
  });

  it("id lạ: không làm gì", () => {
    expect(dongTab([tab("A"), tab("B")], "KHONG-CO", "A")).toBeNull();
  });
});

describe("Ngày hóa đơn theo từng tab — đổi chi nhánh", () => {
  it("mọi tab về tự động và nhận phiên mới", () => {
    const tabs = [
      tab("A", { ngayHoaDon: NGAY_A, lyDoNgayHoaDon: "Máy treo", itemCount: 3 }),
      tab("B", { ngayHoaDon: NGAY_C, lyDoNgayHoaDon: "bán bù", snapshot: { gio: "B" } }),
    ];
    let n = 0;
    const sau = doiChiNhanh(tabs, () => "phien-" + ++n);

    for (const t of sau) {
      expect(t.ngayHoaDon).toBeNull();
      expect(t.lyDoNgayHoaDon).toBe("");
      expect(t.snapshot).toBeNull();
      expect(t.itemCount).toBe(0);
    }
    expect(sau.map((t) => t.sessionId)).toEqual(["phien-1", "phien-2"]);
  });
});

describe("Trang POS phải ĐI QUA mô-đun này", () => {
  /**
   * Bốn ca trên chứng minh mô-đun đúng. Ca này chặn kiểu hỏng còn lại: mô-đun
   * đúng nhưng trang lại tự map tay như cũ ⇒ test xanh mà lỗi vẫn còn. Đây là
   * phép kiểm cấu trúc BỔ SUNG, không thay cho test hành vi ở trên.
   */
  const trang = readFileSync(
    join(process.cwd(), "src/app/pos/page.tsx"),
    "utf8",
  );

  it("switchTab/addTab/closeTab và đổi chi nhánh đều gọi hàm của mô-đun", () => {
    expect(trang).toContain('from "./lib/pos-tab-transitions"');
    for (const ham of ["chuyenTab(", "themTab(", "dongTab(", "doiChiNhanh("]) {
      expect(trang, `trang phải gọi ${ham}`).toContain(ham);
    }
  });

  it("ngày hóa đơn được nạp lại qua datNgayHoaDon sau mỗi lần đổi tab", () => {
    expect(trang).toContain("datNgayHoaDon(ketQua.ngayHoaDon, ketQua.lyDoNgayHoaDon)");
  });

  it("nạp nháp / đơn bán con trả ngày về tự động (không kế thừa ngày cũ)", () => {
    const funnel = trang.slice(
      trang.indexOf("const applyDraftToActiveTab"),
      trang.indexOf("const switchTab"),
    );
    expect(funnel).toContain("datNgayHoaDon(null, \"\")");
  });
});
