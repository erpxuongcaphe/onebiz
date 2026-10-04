import type { StockMovement } from "@/lib/types";

type StockMovementValueInput = Pick<
  StockMovement,
  "type" | "quantity" | "unitCost" | "unitPrice"
>;

type RecordedMovementCost = {
  unit_cost: number | string;
  quantity: number | string;
};

export function getRecordedMovementPrices(
  movement: { type: string; unit_cost: number | null; unit_price: number | null },
  costEvent?: RecordedMovementCost,
): Pick<StockMovement, "unitCost" | "unitPrice" | "recordedPriceSource"> {
  const unitCost = costEvent && Number(costEvent.quantity) > 0
    ? Number(costEvent.unit_cost)
    : null;
  if (unitCost != null && Number.isFinite(unitCost) && unitCost >= 0) {
    return {
      unitCost,
      unitPrice: movement.type === "in" ? unitCost : undefined,
      recordedPriceSource: "branch_cost_ledger",
    };
  }
  const prices = {
    unitCost: movement.unit_cost != null ? Number(movement.unit_cost) : undefined,
    unitPrice: movement.unit_price != null ? Number(movement.unit_price) : undefined,
  };
  const selectedPrice = movement.type === "out" ? prices.unitCost : (prices.unitPrice ?? prices.unitCost);
  return {
    ...prices,
    recordedPriceSource: selectedPrice != null && Number.isFinite(selectedPrice)
      ? "movement_snapshot"
      : "unknown",
  };
}

export function getStockMovementPriceSource(
  movement: StockMovementValueInput & Pick<StockMovement, "recordedPriceSource">,
): { label: string; description: string } {
  if (getStockMovementUnitValue(movement) == null) {
    return { label: "Chưa có đơn giá", description: "Không có đơn giá ghi nhận hợp lệ. Không quy đổi dữ liệu thiếu thành 0." };
  }
  if (movement.recordedPriceSource === "branch_cost_ledger") {
    return { label: "Sổ vốn chi nhánh", description: "Đơn giá từ sự kiện sổ giá vốn chi nhánh liên kết đúng dòng biến động kho." };
  }
  if (movement.recordedPriceSource === "movement_snapshot") {
    return { label: "Giá dòng kho", description: "Đơn giá lưu trên biến động kho. Không thay thế sổ vốn chi nhánh; XNT F&B có thể chưa đủ dữ liệu định giá." };
  }
  return { label: "Chưa rõ nguồn giá", description: "Có đơn giá nhưng chưa xác định được nguồn ghi nhận. Không coi đây là giá vốn chi nhánh đã xác nhận." };
}

export function getSignedStockQuantity(
  movement: Pick<StockMovementValueInput, "type" | "quantity">,
): number {
  return movement.type === "export"
    ? -Math.abs(movement.quantity)
    : Math.abs(movement.quantity);
}

export function getStockMovementUnitValue(
  movement: StockMovementValueInput,
): number | null {
  const value =
    movement.type === "export"
      ? movement.unitCost
      : (movement.unitPrice ?? movement.unitCost);

  if (value == null) return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

export function getStockMovementTotalValue(
  movement: StockMovementValueInput,
): number | null {
  const unitValue = getStockMovementUnitValue(movement);
  if (unitValue == null || !Number.isFinite(movement.quantity)) return null;
  const total = unitValue * Math.abs(movement.quantity);
  return Number.isFinite(total) ? total : null;
}
