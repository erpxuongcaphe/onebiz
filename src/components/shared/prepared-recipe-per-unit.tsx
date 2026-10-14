export function PreparedRecipePerUnit({ quantity, yieldQty, unit }: {
  quantity: number; yieldQty: number; unit: string;
}) {
  const valid = Number.isFinite(quantity) && quantity >= 0 && Number.isFinite(yieldQty) && yieldQty > 0;
  return <span className="block text-right tabular-nums text-muted-foreground" title="Tự tính để đối chiếu; công thức lưu theo mẻ.">
    {valid ? `${new Intl.NumberFormat("vi-VN", { maximumSignificantDigits: 6 }).format(quantity / yieldQty)} ${unit}` : "—"}
  </span>;
}
