import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentNoteBox } from "@/components/shared/document-note-box";

/**
 * 06/08/2026 — CEO phát hiện trên HD001512: ghi chú lưu đúng trong DB,
 * bản in hiện đúng, nhưng các panel chi tiết chứng từ đặt <textarea> TRẦN
 * (không value, không handler) → không hiện ghi chú, gõ vào bị nuốt mất.
 *
 * Quét ra 7 màn cùng bệnh (2 dạng):
 *  - textarea câm: hóa đơn, đặt hàng, trả hàng, phiếu nhập
 *  - không hiện ghi chú ở đâu cả dù form tạo CÓ ô: xuất hủy, trả hàng nhập,
 *    đặt hàng nhập
 */

const NOTE_3_DONG =
  "Anh Thành - 0338764714\n- Xưởng Đặc Biệt: 500g xay pha Moka\n- Địa chỉ: 390/61";

describe("DocumentNoteBox — hành vi", () => {
  it("chế độ hiển thị: hiện ĐỦ ghi chú nhiều dòng, không có textarea", () => {
    const { container } = render(<DocumentNoteBox note={NOTE_3_DONG} />);
    // toàn bộ nội dung phải có mặt (textContent gộp — không bị cắt)
    expect(container.textContent).toContain("Anh Thành - 0338764714");
    expect(container.textContent).toContain("390/61");
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("chế độ hiển thị: ghi chú trống → nói rõ 'Không có ghi chú'", () => {
    render(<DocumentNoteBox note={null} />);
    expect(screen.getByText("Không có ghi chú")).toBeTruthy();
  });

  it("chế độ sửa: textarea PHẢI mồi sẵn ghi chú đã lưu (đây chính là lỗi cũ)", () => {
    const { container } = render(
      <DocumentNoteBox note={NOTE_3_DONG} editable onSave={async () => {}} />,
    );
    const ta = container.querySelector("textarea");
    expect(ta?.value).toBe(NOTE_3_DONG);
    // chưa sửa gì → không hiện nút Lưu
    expect(screen.queryByText("Lưu ghi chú")).toBeNull();
  });

  it("chế độ sửa: đổi nội dung → nút Lưu hiện, bấm → onSave nhận đúng giá trị mới", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <DocumentNoteBox note="cũ" editable onSave={onSave} />,
    );
    const ta = container.querySelector("textarea")!;
    fireEvent.change(ta, { target: { value: "  nội dung mới  " } });
    fireEvent.click(screen.getByText("Lưu ghi chú"));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("nội dung mới"));
  });

  it("nút Hủy trả textarea về ghi chú đã lưu", () => {
    const { container } = render(
      <DocumentNoteBox note="gốc" editable onSave={async () => {}} />,
    );
    const ta = container.querySelector("textarea")!;
    fireEvent.change(ta, { target: { value: "sửa dở" } });
    fireEvent.click(screen.getByText("Hủy"));
    expect(ta.value).toBe("gốc");
  });
});

describe("7 màn chứng từ — không còn ô ghi chú câm", () => {
  const PAGES = [
    "src/app/(main)/don-hang/hoa-don/page.tsx",
    "src/app/(main)/don-hang/dat-hang/page.tsx",
    "src/app/(main)/don-hang/tra-hang/page.tsx",
    "src/app/(main)/hang-hoa/nhap-hang/page.tsx",
    "src/app/(main)/hang-hoa/xuat-huy/page.tsx",
    "src/app/(main)/hang-hoa/tra-hang-nhap/page.tsx",
    "src/app/(main)/hang-hoa/dat-hang-nhap/page.tsx",
  ];

  it.each(PAGES)("%s dùng DocumentNoteBox", (p) => {
    const src = readFileSync(p, "utf8");
    expect(src).toContain("<DocumentNoteBox");
    // cấm tái phạm: textarea có placeholder Ghi chú mà không gắn value
    // (regex bắt <textarea ... placeholder="Ghi chú..." không kèm value=)
    const cau = src.match(/<textarea[^>]*placeholder="Ghi chú\.\.\."[^>]*>/g) ?? [];
    for (const c of cau) expect(c).toContain("value=");
  });

  it("mapper các phiếu mang note lên UI (chống tái phát ở tầng service)", () => {
    for (const [f, fn] of [
      ["src/lib/services/supabase/returns.ts", "mapReturn"],
      ["src/lib/services/supabase/purchase-orders.ts", "mapPurchaseOrder"],
      ["src/lib/services/supabase/inventory.ts", "mapDisposalExport"],
      ["src/lib/services/supabase/purchase-entries.ts", "mapPurchaseReturn"],
      ["src/lib/services/supabase/purchase-entries.ts", "mapPurchaseOrderEntry"],
    ] as const) {
      const src = readFileSync(f, "utf8");
      const body = src.slice(src.indexOf(`function ${fn}`));
      const end = body.indexOf("\n}");
      expect(body.slice(0, end), `${fn} thiếu note`).toContain("note: row.note");
    }
  });
});
