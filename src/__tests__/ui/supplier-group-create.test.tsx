import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateSupplierGroupDialog } from "@/app/(main)/hang-hoa/nha-cung-cap/create-supplier-group-dialog";

const api = vi.hoisted(() => ({ create: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/contexts", () => ({ useToast: () => ({ toast: api.toast }) }));
vi.mock("@/lib/services/supabase/categories", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/services/supabase/categories")>(),
  createCategory: api.create,
}));

beforeEach(() => {
  api.create.mockReset();
  api.toast.mockReset();
  api.create.mockResolvedValue({ name: "Vật tư điện", code: "VTD" });
});
afterEach(cleanup);

describe("tạo nhóm nhà cung cấp Retail", () => {
  it("gợi ý mã từ tên có dấu và chỉ lưu nhóm trong phạm vi nhà cung cấp", async () => {
    const onClose = vi.fn();
    render(<CreateSupplierGroupDialog onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Tên nhóm"), { target: { value: "  Vật tư điện  " } });
    expect(screen.getByLabelText("Mã nhóm")).toHaveValue("VTD");
    expect(screen.getByText("NCC-VTD-001")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tạo nhóm" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(api.create).toHaveBeenCalledExactlyOnceWith({ name: "Vật tư điện", code: "VTD", scope: "supplier" });
  });

  it("giữ mã tự nhập và cho sửa khi máy chủ trả lỗi trùng", async () => {
    api.create.mockRejectedValueOnce({ code: "23505" });
    const onClose = vi.fn();
    render(<CreateSupplierGroupDialog onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Mã nhóm"), { target: { value: "bbi" } });
    fireEvent.change(screen.getByLabelText("Tên nhóm"), { target: { value: "Bao bì mới" } });
    expect(screen.getByLabelText("Mã nhóm")).toHaveValue("BBI");
    fireEvent.click(screen.getByRole("button", { name: "Tạo nhóm" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Mã nhóm BBI đã có");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Mã nhóm")).toHaveValue("BBI");
  });

  it("chặn mã nội bộ NB và mã sai quy cách", () => {
    render(<CreateSupplierGroupDialog onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Tên nhóm"), { target: { value: "Nhóm mới" } });
    const code = screen.getByLabelText("Mã nhóm");
    const save = screen.getByRole("button", { name: "Tạo nhóm" });
    for (const value of ["NB", "1AB", "A-B", "A"]) {
      fireEvent.change(code, { target: { value } });
      expect(save).toBeDisabled();
    }
    expect(api.create).not.toHaveBeenCalled();
  });
});
