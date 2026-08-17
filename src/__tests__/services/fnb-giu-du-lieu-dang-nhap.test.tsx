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
 * 16/08/2026 — mục C: dữ liệu người bán đang chọn KHÔNG được tự mất.
 *
 * LỖI THẬT (đo trên origin/main 84713aa):
 *   `pos/fnb/page.tsx:3286` dựng prop `dynamicModifiers` bằng object literal
 *   MỚI mỗi lần render:
 *       dynamicModifiers={ itemModifierData ? {...itemModifierData, groups: loc(...)} : ... }
 *   còn `fnb-item-dialog.tsx:395` lại để object đó trong danh sách phụ thuộc
 *   của effect reset toàn bộ lựa chọn.
 *   → POS FnB render lại (đồng hồ, trạng thái kết nối, hàng đợi đồng bộ,
 *     realtime bàn) là Size / đường / đá / topping / ghi chú vừa chọn bị xoá.
 *
 * Test dựng đúng cảnh đó: popup đang mở, người bán đã chọn, rồi cha render
 * lại với object NỘI DUNG Y HỆT nhưng khác tham chiếu.
 */

const SP = {
  id: "sp-1",
  name: "Cà phê sữa",
  sell_price: 25000,
  category_id: "cat-1",
};

function nhom(id: string, name: string): ModifierGroup {
  return {
    id,
    tenantId: "tn-1",
    name,
    rule: "single",
    channel: "fnb",
    sortOrder: 1,
    minSelect: 0,
    maxSelect: null,
    isActive: true,
    createdAt: "",
    updatedAt: "",
  };
}

function luaChon(
  id: string,
  groupId: string,
  label: string,
  isDefault = false,
): ModifierOption {
  return {
    id,
    tenantId: "tn-1",
    groupId,
    label,
    priceDelta: 0,
    isDefault,
    sortOrder: 1,
    isActive: true,
    createdAt: "",
    updatedAt: "",
    scaleFactor: null,
    linkedProductId: null,
  } as unknown as ModifierOption;
}

/** Dựng dữ liệu tuỳ chọn MỚI hoàn toàn nhưng nội dung y hệt nhau. */
function duLieuTuyChon(): DynamicModifierData {
  const g = nhom("g-duong", "Mức đường");
  return {
    groups: [g],
    optionsByGroup: new Map([
      [
        g.id,
        [
          luaChon("o-100", g.id, "100% đường", true),
          luaChon("o-50", g.id, "50% đường"),
        ],
      ],
    ]),
  };
}

/**
 * Nhãn lựa chọn xuất hiện ở CẢ nút bấm lẫn dòng tóm tắt, nên phải lấy đúng
 * phần tử là nút có `aria-pressed` — đó là nơi thể hiện trạng thái chọn.
 */
function dangChon(nhan: string): string | null {
  const nut = screen
    .getAllByText(nhan)
    .map((el) => el.closest("button[aria-pressed]"))
    .find(Boolean) as HTMLButtonElement | undefined;
  if (!nut) throw new Error(`Khong tim thay nut lua chon: ${nhan}`);
  return nut.getAttribute("aria-pressed");
}

function bamChon(nhan: string) {
  const nut = screen
    .getAllByText(nhan)
    .map((el) => el.closest("button[aria-pressed]"))
    .find(Boolean) as HTMLButtonElement | undefined;
  if (!nut) throw new Error(`Khong tim thay nut lua chon: ${nhan}`);
  fireEvent.click(nut);
}

function moPopup(duLieu: DynamicModifierData) {
  return render(
    <FnbItemDialog
      open
      onOpenChange={() => {}}
      product={SP}
      onConfirm={() => {}}
      dynamicModifiers={duLieu}
      onRetryModifiers={() => {}}
    />,
  );
}

describe("Popup chọn món — cha render lại không được xoá lựa chọn đang dở", () => {
  it("đổi 100% → 50% đường, cha render lại: vẫn giữ 50%", () => {
    const { rerender } = moPopup(duLieuTuyChon());

    // Mặc định là 100%; người bán đổi sang 50%.
    expect(
      dangChon("100% đường"),
    ).toBe("true");
    bamChon("50% đường");
    expect(
      dangChon("50% đường"),
    ).toBe("true");

    // Cha render lại với object MỚI, nội dung y hệt (đúng như page đang làm).
    rerender(
      <FnbItemDialog
        open
        onOpenChange={() => {}}
        product={SP}
        onConfirm={() => {}}
        dynamicModifiers={duLieuTuyChon()}
        onRetryModifiers={() => {}}
      />,
    );

    // Lựa chọn phải y nguyên — trước bản vá, nó bị đá về mặc định 100%.
    expect(
      dangChon("50% đường"),
    ).toBe("true");
    expect(
      dangChon("100% đường"),
    ).toBe("false");
  });

  it("gõ ghi chú rồi cha render lại: ghi chú còn nguyên", () => {
    const { rerender } = moPopup(duLieuTuyChon());

    const oGhiChu = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(oGhiChu).toBeTruthy();
    fireEvent.change(oGhiChu, { target: { value: "ít đá, nhiều sữa" } });
    expect(oGhiChu.value).toBe("ít đá, nhiều sữa");

    rerender(
      <FnbItemDialog
        open
        onOpenChange={() => {}}
        product={SP}
        onConfirm={() => {}}
        dynamicModifiers={duLieuTuyChon()}
        onRetryModifiers={() => {}}
      />,
    );

    const oSau = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(oSau.value).toBe("ít đá, nhiều sữa");
  });

  it("số lượng đang tăng: cha render lại vẫn giữ nguyên", () => {
    const { rerender } = moPopup(duLieuTuyChon());

    // Nút tăng số lượng nằm cạnh ô số — bấm 2 lần thành 3.
    const nutTang = screen
      .getAllByRole("button")
      .find((b) => b.querySelector('[class*="material-symbols"]')?.textContent === "add");
    if (nutTang) {
      fireEvent.click(nutTang);
      fireEvent.click(nutTang);
    }
    const truoc = screen.getByText("3", { selector: "*" });
    expect(truoc).toBeTruthy();

    rerender(
      <FnbItemDialog
        open
        onOpenChange={() => {}}
        product={SP}
        onConfirm={() => {}}
        dynamicModifiers={duLieuTuyChon()}
        onRetryModifiers={() => {}}
      />,
    );

    expect(screen.getByText("3", { selector: "*" })).toBeTruthy();
  });

  it("đóng rồi mở lại popup thì VẪN reset — đóng có chủ ý không được giữ dữ liệu", () => {
    const duLieu = duLieuTuyChon();
    const { rerender } = moPopup(duLieu);

    bamChon("50% đường");
    expect(
      dangChon("50% đường"),
    ).toBe("true");

    // Đóng popup...
    rerender(
      <FnbItemDialog
        open={false}
        onOpenChange={() => {}}
        product={SP}
        onConfirm={() => {}}
        dynamicModifiers={duLieu}
        onRetryModifiers={() => {}}
      />,
    );
    // ...rồi mở lại: phải quay về mặc định 100%, KHÔNG giữ 50% của lần trước.
    rerender(
      <FnbItemDialog
        open
        onOpenChange={() => {}}
        product={SP}
        onConfirm={() => {}}
        dynamicModifiers={duLieu}
        onRetryModifiers={() => {}}
      />,
    );

    expect(
      dangChon("50% đường"),
    ).toBe("false");
    expect(
      dangChon("100% đường"),
    ).toBe("true");
  });
});
