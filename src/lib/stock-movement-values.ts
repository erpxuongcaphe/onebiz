import type { StockMovement } from "@/lib/types";

type StockMovementValueInput = Pick<
  StockMovement,
  "type" | "quantity" | "unitCost" | "unitPrice"
>;

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

  return value == null ? null : Number(value);
}

export function getStockMovementTotalValue(
  movement: StockMovementValueInput,
): number | null {
  const unitValue = getStockMovementUnitValue(movement);
  return unitValue == null ? null : unitValue * Math.abs(movement.quantity);
}
