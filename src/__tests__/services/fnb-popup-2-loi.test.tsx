import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  FnbItemDialog,
  type DynamicModifierData,
} from "@/app/pos/fnb/components/fnb-item-dialog";

/**
 * 06/08/2026 — PR-A: hai lỗi THẬT trong popup chọn món (CEO duyệt plan).
 *
 * LỖI 1 — tải tuỳ chọn lỗi bị nuốt thành "món không có tuỳ chọn", VÀ CÒN
 * ĐƯỢC CACHE (page.tsx cũ). Hậu quả: mạng chớp 1 lần → món đó vĩnh viễn
 * không hỏi Đường/Đá/Topping cả phiên → bếp pha sai + KHÔNG thu tiền
 * topping. Nặng nhất: món không có size thì code còn quick-add thẳng vào giỏ.
 *
 * LỖI 2 — không chống bấm xác nhận 2 lần → 2 dòng trong giỏ.
 * CEO chốt: khoá phải là ref (tức thì) + state, KHÔNG chỉ dựa state React
 * vì setState không đổi giá trị ngay trong cùng nhịp bấm.
 */

const SP = {
  id: "sp-1",
  name: "Cà phê sữa",
  sell_price: 25000,
  category_id: "cat-1",
};

function duLieuOK(): DynamicModifierData {
  return { groups: [], optionsByGroup: new Map() };
}
function duLieuLoi(): DynamicModifierData {
  return { groups: [], optionsByGroup: new Map(), failed: true };
}

describe("LỖI 1 — tải tuỳ chọn hỏng phải NÓI THẬT, không giả vờ 'không có tuỳ chọn'", () => {
  it("tải hỏng: hiện thông báo lỗi + nút Thử lại, KHOÁ nút thêm", () => {
    render(
      <FnbItemDialog
        open
        onOpenChange={() => {}}
        product={SP}
        onConfirm={() => {}}
        dynamicModifiers={duLieuLoi()}
        onRetryModifiers={() => {}}
      />,
    );
    expect(screen.getByText("Không tải được tuỳ chọn của món")).toBeTruthy();
    expect(screen.getByText("Thử lại")).toBeTruthy();
    const nut = screen.getByText("Chưa tải được tuỳ chọn").closest("button")!;
    expect(nut.disabled).toBe(true);
  });

  it("bấm Thử lại → gọi lại hàm tải (lỗi KHÔNG cache nên là fetch mới thật)", () => {
    const retry = vi.fn();
    render(
      <FnbItemDialog
        open
        onOpenChange={() => {}}
        product={SP}
        onConfirm={() => {}}
        dynamicModifiers={duLieuLoi()}
        onRetryModifiers={retry}
      />,
    );
    fireEvent.click(screen.getByText("Thử lại"));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("đang tải (chưa có dữ liệu): khoá nút, KHÔNG báo nhầm là thiếu mục bắt buộc", () => {
    render(
      <FnbItemDialog
        open
        onOpenChange={() => {}}
        product={SP}
        onConfirm={() => {}}
        dynamicModifiers={undefined}
      />,
    );
    const nut = screen.getByText("Đang tải tuỳ chọn…").closest("button")!;
    expect(nut.disabled).toBe(true);
    expect(screen.queryByText(/BẮT BUỘC chưa chọn/)).toBeNull();
    expect(screen.queryByText("Mức đường")).toBeNull();
    expect(screen.queryByText("Không đá")).toBeNull();
  });

  it("tải xong, món thật sự KHÔNG có tuỳ chọn: cho thêm bình thường", () => {
    render(
      <FnbItemDialog
        open
        onOpenChange={() => {}}
        product={SP}
        onConfirm={() => {}}
        dynamicModifiers={duLieuOK()}
      />,
    );
    const nut = screen.getByText(/Thêm vào đơn/).closest("button")!;
    expect(nut.disabled).toBe(false);
  });

  it("tầng dữ liệu: lỗi KHÔNG được ghi vào bộ nhớ tạm", () => {
    const src = readFileSync("src/app/pos/fnb/page.tsx", "utf8");
    const than = src.slice(
      src.indexOf("const loadModifierForProduct"),
      src.indexOf("// ── Warm variant cache"),
    );
    const nhanhCatch = than.slice(than.indexOf("} catch"));
    expect(nhanhCatch).toContain("failed: true");
    expect(nhanhCatch, "nhánh lỗi KHÔNG được set cache").not.toContain(
      "modifierCacheRef.set",
    );
  });

  it("tầng gọi: tải lỗi thì KHÔNG quick-add thẳng vào giỏ", () => {
    const src = readFileSync("src/app/pos/fnb/page.tsx", "utf8");
    // điều kiện quick-add phải kèm !modData.failed
    expect(src).toContain("modData.groups.length === 0 && !modData.failed");
  });

  it("variant cache rỗng nhưng modifier cache chưa có thì phải chờ máy chủ", () => {
    const src = readFileSync("src/app/pos/fnb/page.tsx", "utf8");
    const nhanhVariantDaCache = src.slice(
      src.indexOf("if (cached.length === 0)"),
      src.indexOf("// SP có ≥1 biến thể"),
    );
    expect(nhanhVariantDaCache).toContain("await modifierPromise");
    expect(nhanhVariantDaCache).toContain("modData.groups.length > 0 || modData.failed");
    expect(nhanhVariantDaCache.indexOf("await modifierPromise")).toBeLessThan(
      nhanhVariantDaCache.indexOf("quickAdd()"),
    );
  });

  it("cache tuỳ chọn có hạn dùng và bị xoá khi đổi chi nhánh", () => {
    const src = readFileSync("src/app/pos/fnb/page.tsx", "utf8");
    expect(src).toContain("const MODIFIER_CACHE_TTL_MS = 60_000");
    expect(src).toContain("Date.now() - entry.loadedAt >= MODIFIER_CACHE_TTL_MS");
    expect(src).toContain("modifierCacheRef.clear()");
    expect(src).toContain("[tenantId, branchId, modifierCacheRef]");
  });

  it("phản hồi món cũ không được ghi đè popup món mới", () => {
    const src = readFileSync("src/app/pos/fnb/page.tsx", "utf8");
    expect(src).toContain("const requestId = ++itemLoadRequestRef.current");
    expect(src).toContain("itemLoadRequestRef.current !== requestId");
    expect(src).toContain("itemLoadRequestRef.current === requestId");
    expect(src).toContain("itemLoadRequestRef.current += 1");
  });
});

describe("LỖI 2 — chống bấm xác nhận 2 lần", () => {
  it("bấm 2 lần TRONG CÙNG NHỊP (không đợi render) → chỉ vào giỏ 1 lần", () => {
    const onConfirm = vi.fn();
    render(
      <FnbItemDialog
        open
        onOpenChange={() => {}}
        product={SP}
        onConfirm={onConfirm}
        dynamicModifiers={duLieuOK()}
      />,
    );
    const nut = screen.getByText(/Thêm vào đơn/).closest("button")!;
    // hai cú bấm liên tiếp — state chưa kịp cập nhật giữa hai lần
    fireEvent.click(nut);
    fireEvent.click(nut);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("khoá dùng REF (tức thì) chứ không chỉ state — đọc mã để chống tái phạm", () => {
    const src = readFileSync(
      "src/app/pos/fnb/components/fnb-item-dialog.tsx",
      "utf8",
    );
    expect(src).toContain("submitLockRef");
    expect(src).toContain("useRef(false)");
    // dòng chặn phải là dòng ĐẦU của handleConfirm
    const than = src.slice(src.indexOf("const handleConfirm"));
    const dongDau = than.slice(0, than.indexOf("\n", than.indexOf("{") + 1) + 200);
    expect(dongDau).toContain("submitLockRef.current");
  });
});

describe("Ranh giới an toàn — KHÔNG đụng cách tính tiền", () => {
  it("công thức đơn giá + thành tiền giữ nguyên", () => {
    const src = readFileSync(
      "src/app/pos/fnb/components/fnb-item-dialog.tsx",
      "utf8",
    );
    expect(src).toContain(
      "const lineTotal = (unitPrice + toppingTotal + dynamicModifierExtra) * quantity;",
    );
    expect(src).toContain("unitPrice: unitPrice + dynamicModifierExtra,");
  });
});
