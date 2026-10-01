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
): Pick<StockMovement, "unitCost" | "unitPrice"> {
  const unitCost = costEvent && Number(costEvent.quantity) > 0
    ? Number(costEvent.unit_cost)
    : null;
  if (unitCost != null && Number.isFinite(unitCost) && unitCost >= 0) {
    return {
      unitCost,
      unitPrice: movement.type === "in" ? unitCost : undefined,
    };
  }
  return {
    unitCost: movement.unit_cost != null ? Number(movement.unit_cost) : undefined,
    unitPrice: movement.unit_price != null ? Number(movement.unit_price) : undefined,
  };
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

  return value == null ? null : Number(value);
}

export function getStockMovementTotalValue(
  movement: StockMovementValueInput,
): number | null {
  const unitValue = getStockMovementUnitValue(movement);
  return unitValue == null ? null : unitValue * Math.abs(movement.quantity);
}
