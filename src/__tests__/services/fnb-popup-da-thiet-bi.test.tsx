import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  FnbItemDialog,
  type DynamicModifierData,
} from "@/app/pos/fnb/components/fnb-item-dialog";
import type {
  ModifierGroup,
  ModifierOption,
} from "@/lib/services/supabase/modifier-groups";

/**
 * PR-B — popup chọn món theo thiết bị (06/08/2026, CEO chốt).
 *
 * Ranh giới của PR này: CHỈ bố cục + trải nghiệm. Không đụng cách tính giá,
 * quy cách, Size, Topping, BOM, tồn kho. Test cuối cùng khoá đúng điều đó.
 */

const SP = { id: "sp-1", name: "Trà sữa trân châu đường đen size lớn", sell_price: 35000 };

function nhom(
  id: string,
  name: string,
  rule: ModifierGroup["rule"],
): ModifierGroup {
  return {
    id,
    tenantId: "t",
    name,
    rule,
    channel: "fnb",
    sortOrder: 0,
    isActive: true,
    createdAt: "",
    updatedAt: "",
  };
}

function opt(
  id: string,
  groupId: string,
  label: string,
  priceDelta = 0,
): ModifierOption {
  return {
    id,
    groupId,
    label,
    priceDelta,
    scaleFactor: null,
    linkedProductId: null,
    isDefault: false,
    sortOrder: 0,
    isActive: true,
  };
}

/** Một nhóm KHÔNG bắt buộc (Mức đá) + một nhóm BẮT BUỘC (Size) chưa chọn. */
function duLieu(): DynamicModifierData {
  const gDa = nhom("g-da", "Mức đá", "single");
  const gSize = nhom("g-size", "Size", "single_required");
  return {
    groups: [gDa, gSize],
    optionsByGroup: new Map<string, ModifierOption[]>([
      ["g-da", [opt("o-it", "g-da", "Ít đá"), opt("o-nhieu", "g-da", "Nhiều đá")]],
      ["g-size", [opt("o-m", "g-size", "Vừa"), opt("o-l", "g-size", "Lớn", 5000)]],
    ]),
  };
}

function moPopup(props: Partial<React.ComponentProps<typeof FnbItemDialog>> = {}) {
  return render(
    <FnbItemDialog
      open
      onOpenChange={() => {}}
      product={SP}
      onConfirm={() => {}}
      dynamicModifiers={duLieu()}
      {...props}
    />,
  );
}

describe("PR-B · ba trạng thái của nhóm tuỳ chọn", () => {
  it("nhóm BẮT BUỘC chưa chọn → nói rõ 'Chưa chọn — bắt buộc'", () => {
    moPopup();
    expect(screen.getByText("Chưa chọn — bắt buộc")).toBeTruthy();
  });

  it("nhóm đã chọn → nhãn hiện ĐANG CHỌN GÌ (không phải chỉ tô màu)", () => {
    moPopup();
    fireEvent.click(screen.getByText("Ít đá"));
    expect(screen.getByText("Ít đá", { selector: "span.text-foreground" })).toBeTruthy();
    expect(screen.getByText(/Đang chọn:/)).toBeTruthy();
  });

  it("nhóm KHÔNG bắt buộc và chưa chọn → chỉ hiện quy tắc, không báo động", () => {
    moPopup();
    expect(screen.getByText("Chọn 1")).toBeTruthy();
  });

  it("chọn đủ mục bắt buộc → hết cảnh báo, nút thêm mở khoá", () => {
    moPopup();
    expect(screen.getByText(/BẮT BUỘC chưa chọn/)).toBeTruthy();
    fireEvent.click(screen.getByText("Vừa"));
    expect(screen.queryByText("Chưa chọn — bắt buộc")).toBeNull();
    const nut = screen.getByText(/Thêm vào đơn/).closest("button")!;
    expect(nut.disabled).toBe(false);
  });
});

describe("PR-B · thu gọn nhóm mà KHÔNG mất lựa chọn", () => {
  it("nhóm bắt buộc CHƯA chọn thì KHÔNG cho thu gọn (giấu đúng chỗ đang thiếu)", () => {
    moPopup();
    const nhanSize = screen.getByText("Size");
    expect(nhanSize.closest("button")).toBeNull();
  });

  it("thu gọn rồi bung lại → lựa chọn còn nguyên", () => {
    moPopup();
    fireEvent.click(screen.getByText("Ít đá"));
    const nutNhan = screen.getByText("Mức đá").closest("button")!;

    fireEvent.click(nutNhan); // thu gọn
    expect(nutNhan.getAttribute("aria-expanded")).toBe("false");
    // Nút lựa chọn vẫn NẰM TRONG cây React — chỉ bị ẩn bằng CSS.
    const nutItDa = screen
      .getAllByText("Ít đá")
      .map((el) => el.closest("button"))
      .find((b) => b?.getAttribute("aria-pressed") !== null)!;
    expect(nutItDa.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(nutNhan); // bung lại
    expect(nutNhan.getAttribute("aria-expanded")).toBe("true");
    expect(nutItDa.getAttribute("aria-pressed")).toBe("true");
  });

  it("nhãn vẫn nói đang chọn gì KỂ CẢ khi nhóm đang thu gọn", () => {
    moPopup();
    fireEvent.click(screen.getByText("Nhiều đá"));
    fireEvent.click(screen.getByText("Mức đá").closest("button")!);
    expect(screen.getByText(/Đang chọn:/)).toBeTruthy();
  });
});

describe("PR-B · thứ tự nhóm ĐỨNG YÊN khi đang chọn", () => {
  /**
   * Đọc nhãn các nhóm theo đúng thứ tự đang hiện trên màn.
   * Dialog render qua portal ra `document.body`, KHÔNG nằm trong `container`
   * mà render() trả về — soi nhầm chỗ là ra mảng rỗng và test xanh giả.
   */
  function thuTuNhom(): string[] {
    return [...document.body.querySelectorAll("section")]
      .map((s) => s.querySelector("span.text-sm.font-medium")?.textContent ?? "")
      .filter(Boolean);
  }

  it("nhóm bắt buộc đứng trước nhóm thường, kể cả khi sort_order đều = 0", () => {
    moPopup();
    const thuTu = thuTuNhom();
    expect(thuTu).toContain("Size");
    expect(thuTu).toContain("Mức đá");
    expect(thuTu.indexOf("Size")).toBeLessThan(thuTu.indexOf("Mức đá"));
  });

  it("chọn xong mục bắt buộc → thứ tự KHÔNG đổi (chip không nhảy dưới ngón tay)", () => {
    moPopup();
    const truoc = thuTuNhom();
    expect(truoc.length).toBeGreaterThan(1);
    fireEvent.click(screen.getByText("Vừa"));
    expect(thuTuNhom()).toEqual(truoc);
    fireEvent.click(screen.getByText("Ít đá"));
    expect(thuTuNhom()).toEqual(truoc);
  });

  it("HAI nhóm bắt buộc: chọn nhóm đầu KHÔNG đẩy nhóm còn thiếu lên trên", () => {
    // Đây mới là ca nhảy THẬT. Với một nhóm bắt buộc thì dù xếp kiểu nào thứ
    // tự cũng không đổi — test ở trên xanh cả khi mã sai. Bản nháp của em
    // xếp "còn thiếu" lên đầu: bấm Size xong là Mức đường nhảy lên trước
    // Size, đúng lúc ngón tay đang ở đó.
    const gSize = nhom("g-size", "Size", "single_required");
    const gDuong = nhom("g-duong", "Mức đường", "single_required");
    moPopup({
      dynamicModifiers: {
        groups: [gSize, gDuong],
        optionsByGroup: new Map<string, ModifierOption[]>([
          ["g-size", [opt("o-m", "g-size", "Vừa"), opt("o-l", "g-size", "Lớn", 5000)]],
          [
            "g-duong",
            [opt("o-0", "g-duong", "Không đường"), opt("o-100", "g-duong", "100%")],
          ],
        ]),
      },
    });
    // Cùng mức ưu tiên · cùng sort_order · cùng số lựa chọn → tiêu chí cuối
    // là tên A→Z tiếng Việt, nên "Mức đường" đứng trước "Size".
    const truoc = thuTuNhom();
    expect(truoc).toEqual(["Mức đường", "Size"]);
    fireEvent.click(screen.getByText("Vừa"));
    expect(thuTuNhom()).toEqual(truoc);
    fireEvent.click(screen.getByText("100%"));
    expect(thuTuNhom()).toEqual(truoc);
  });
});

describe("PR-B · KHÔNG đụng tiền", () => {
  it("chọn Size Lớn (+5.000) → tổng đúng 40.000, y như trước", () => {
    moPopup();
    fireEvent.click(screen.getByText(/^Lớn/));
    expect(screen.getByText(/Thêm vào đơn — 40.000đ/)).toBeTruthy();
  });

  it("payload gửi đi giữ nguyên giá đã cộng tuỳ chọn", () => {
    const onConfirm = vi.fn();
    moPopup({ onConfirm });
    fireEvent.click(screen.getByText(/^Lớn/));
    fireEvent.click(screen.getByText(/Thêm vào đơn/).closest("button")!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0].unitPrice).toBe(40000);
    expect(onConfirm.mock.calls[0][0].quantity).toBe(1);
  });
});

/**
 * Bỏ chú thích trước khi soi mã — bẫy đã dính nhiều lần: chú thích giải
 * thích lỗi cũ lại chứa đúng chuỗi đang đi tìm.
 */
function boChuThich(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((d) => !d.trim().startsWith("//"))
    .join("\n");
}
/** Chỉ lấy nội dung các chuỗi className — không quét cả tệp. */
function cacClassName(src: string): string {
  return (src.match(/className=(?:"[^"]*"|\{cn\([\s\S]*?\)\})/g) ?? []).join(" | ");
}

describe("PR-B · khoá các ràng buộc bố cục", () => {
  const nguon = boChuThich(
    readFileSync("src/app/pos/fnb/components/fnb-item-dialog.tsx", "utf8"),
  );
  const lop = cacClassName(nguon);

  it("bề ngang riêng cho từng thiết bị, không phải bản desktop thu nhỏ", () => {
    expect(nguon).toContain("sm:max-w-[42rem]");
    expect(nguon).toContain("lg:max-w-[56rem]");
    expect(nguon).toContain("xl:max-w-[68rem]");
  });

  it("thân xếp theo NỘI DUNG, không chia đều mỗi nhóm một cột", () => {
    // CEO bác bản trước vì mọi nhóm bị nhét vào cùng một lưới cột bằng nhau.
    // Nay thân là CỘT DỌC, và khu lựa chọn ngắn là hàng ngang tự xuống dòng
    // với mỗi ô RỘNG THEO NỘI DUNG (`flex-auto` = khởi điểm bằng nội dung).
    expect(nguon).toContain("flex-1 overflow-y-auto overflow-x-hidden py-2 flex flex-col gap-4");
    expect(nguon).toContain("flex flex-wrap items-start gap-x-6 gap-y-3.5");
    expect(nguon).toContain("sm:flex-auto");
    // Đo trên bản xem trước: lưới chia đều ép "Mức đường" (5 lựa chọn) xuống
    // 2 dòng trong khi ô thứ ba bỏ trống. KHÔNG được quay lại kiểu đó.
    expect(nguon).not.toContain("sm:grid-cols-2 xl:grid-cols-3");
  });

  it("giữ nguyên khung 3 phần của PR trước (đầu / thân cuộn / chân)", () => {
    expect(nguon).toContain("max-h-[calc(100dvh-2rem)]");
    expect(nguon).toContain("min-h-0 flex-1 overflow-y-auto");
    expect(nguon).toContain('<DialogFooter className="shrink-0">');
  });

  it("KHÔNG còn vùng chạm co nhỏ ở desktop (sm:h-8 / sm:size-8 / sm:py-2)", () => {
    expect(lop).not.toContain("sm:h-8");
    expect(lop).not.toContain("sm:size-8");
    expect(lop).not.toContain("sm:w-8");
  });

  it("vùng chạm nở 44px theo NGÓN TAY, không theo bề rộng màn", () => {
    // Bẫy đã dính: biến thể `icon` của Button là `size-9 md:size-8`; gộp
    // class chỉ thay được `size-9` nên desktop vẫn ra 32px. Nay popup không
    // dùng `size="icon"` nữa mà tự khai lớp, và nở theo `pointer-coarse`.
    expect(nguon).not.toContain('size="icon"');
    for (const hang of nguon.split("\n")) {
      if (!/\bsize-9\b/.test(hang)) continue;
      expect(hang, "size-9 phải đi kèm pointer-coarse:size-11").toContain(
        "pointer-coarse:size-11",
      );
    }
    expect(nguon).toContain("min-h-9 pointer-coarse:min-h-11");
  });

  it("SỐ LƯỢNG nằm cùng hàng với tên/giá ở đầu popup, không chiếm riêng một cột", () => {
    const dauPopup = nguon.slice(
      nguon.indexOf("<DialogHeader"),
      nguon.indexOf("</DialogHeader>"),
    );
    expect(dauPopup).toContain('aria-label="Bớt số lượng"');
    expect(dauPopup).toContain('aria-label="Thêm số lượng"');
    expect(dauPopup).toContain("Tạm tính");
  });

  it("Size đứng TRƯỚC mọi nhóm tuỳ chọn khác trong khu lựa chọn chính", () => {
    const viTriSize = nguon.indexOf("Kích cỡ");
    const viTriNhomNgan = nguon.indexOf("nhomNgan.map(veNhom)");
    expect(viTriSize).toBeGreaterThan(0);
    expect(viTriNhomNgan).toBeGreaterThan(viTriSize);
  });

  it("nhóm chọn-nhiều (Topping) nằm DƯỚI khu lựa chọn ngắn và trải 2 cột ở desktop", () => {
    expect(nguon).toContain('nhomDai = nhomDaSapXep.filter((g) => g.rule === "multi")');
    expect(nguon).toContain('nhomNgan = nhomDaSapXep.filter((g) => g.rule !== "multi")');
    expect(nguon.indexOf("nhomDai.map(veNhom)")).toBeGreaterThan(
      nguon.indexOf("nhomNgan.map(veNhom)"),
    );
    expect(nguon).toContain("grid gap-2 xl:grid-cols-2");
  });

  it("KHÔNG cắt chữ bằng '…' ở tiền, và không có cỡ chữ dưới 11px", () => {
    expect(lop).not.toContain("truncate");
    expect(lop).not.toContain("text-[10px]");
    expect(lop).not.toContain("text-[9px]");
  });

  it("KHÔNG đo bề rộng bằng JS rồi render nhánh khác (xoay máy là mất chọn)", () => {
    expect(nguon).not.toContain("window.innerWidth");
    expect(nguon).not.toContain("matchMedia");
    expect(nguon).not.toContain("useMediaQuery");
  });

  it("công thức tiền KHÔNG đổi một ký tự", () => {
    expect(nguon).toContain(
      "const lineTotal = (unitPrice + toppingTotal + dynamicModifierExtra) * quantity;",
    );
    expect(nguon).toContain(
      "const unitPrice = selectedVariant?.sell_price ?? product?.sell_price ?? 0;",
    );
    expect(nguon).toContain("unitPrice: unitPrice + dynamicModifierExtra,");
  });

  it("khoá chống bấm đúp của PR-A còn nguyên", () => {
    expect(nguon).toContain("submitLockRef");
    expect(nguon).toContain("if (submitLockRef.current) return;");
  });
});
