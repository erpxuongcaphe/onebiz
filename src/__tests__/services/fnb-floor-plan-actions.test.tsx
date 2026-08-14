import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TableActionSheet } from "@/components/shared/floor-plan/table-action-sheet";
import type { CanvasTable } from "@/components/shared/floor-plan/floor-plan-canvas";

function table(status: CanvasTable["status"], unpaidOrders = 0): CanvasTable {
  return {
    id: "table-1",
    zoneId: "zone-1",
    shape: "square",
    width: 60,
    height: 60,
    rotation: 0,
    positionX: 0,
    positionY: 0,
    color: null,
    locked: false,
    tableNumber: 1,
    name: "Bàn 1",
    capacity: 4,
    status,
    unpaidOrders,
  };
}

describe("Sơ đồ bàn FnB chỉ hiện hành động đã có luồng an toàn", () => {
  it("bàn có đơn chỉ hiện các hành động đã được cấp quyền", () => {
    const onAction = vi.fn();
    render(
      <TableActionSheet
        table={table("occupied", 1)}
        onAction={onAction}
        onClose={vi.fn()}
        canTransfer
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Chuyển bàn" }));
    expect(onAction).toHaveBeenCalledWith("transfer", expect.objectContaining({ id: "table-1" }));
    expect(screen.queryByRole("button", { name: "Gộp đơn" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hủy đặt" })).not.toBeInTheDocument();
  });

  it("bàn có đơn gọi đúng hành động gộp khi đã được cấp quyền", () => {
    const onAction = vi.fn();
    render(
      <TableActionSheet
        table={table("occupied", 1)}
        onAction={onAction}
        onClose={vi.fn()}
        canMerge
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Gộp đơn" }));
    expect(onAction).toHaveBeenCalledWith("merge", expect.objectContaining({ id: "table-1" }));
    expect(screen.queryByRole("button", { name: "Chuyển bàn" })).not.toBeInTheDocument();
  });

  it("bàn đang dọn hiển thị đúng hành động thay vì nói mở đơn mới", () => {
    render(
      <TableActionSheet
        table={table("cleaning")}
        onAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Xác nhận đã dọn" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mở đơn mới" })).not.toBeInTheDocument();
  });

  it("bàn đặt trước không còn hiện nút chết chưa có backend", () => {
    render(
      <TableActionSheet
        table={table("reserved")}
        onAction={vi.fn()}
        onClose={vi.fn()}
        canTransfer
      />,
    );

    expect(screen.queryByRole("button", { name: "Xem đơn" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Chuyển bàn" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hủy đặt" })).not.toBeInTheDocument();
  });
});
