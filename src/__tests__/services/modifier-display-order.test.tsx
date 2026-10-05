import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModifierOrderPicker } from "@/components/shared/modifier-order-picker";
import { modifierOrderMode, moveModifierId, orderedModifierIds } from "@/lib/modifier-display-order";

const groups = [
  { id: "ice", name: "Mức đá", sortOrder: 20 },
  { id: "sugar", name: "Mức đường", sortOrder: 10 },
  { id: "topping", name: "Topping", sortOrder: 30 },
];

describe("Modifier ordering preserves existing choices", () => {
  it("distinguishes old custom links from explicitly shared links", () => {
    expect(modifierOrderMode([{ useCommonOrder: false }])).toBe("custom");
    expect(modifierOrderMode([{}])).toBe("custom");
    expect(modifierOrderMode([{ useCommonOrder: true }, { useCommonOrder: false }])).toBe("custom");
    expect(modifierOrderMode([{ useCommonOrder: true }])).toBe("common");
    expect(modifierOrderMode([])).toBe("common");
  });
  it("shares global rank while preserving an explicit custom sequence", () => {
    const selection = new Set(["ice", "topping", "sugar"]);
    expect(orderedModifierIds(groups, selection, "common")).toEqual(["sugar", "ice", "topping"]);
    expect(orderedModifierIds(groups, selection, "custom")).toEqual(["ice", "topping", "sugar"]);
    expect([...selection]).toEqual(["ice", "topping", "sugar"]);
  });
  it("does not remove unavailable selected groups or mutate boundary moves", () => {
    const ids = ["ice", "sugar"];
    expect(moveModifierId(ids, "ice", -1)).toBe(ids);
    expect(moveModifierId(ids, "sugar", 1)).toBe(ids);
    expect(moveModifierId(ids, "missing", 1)).toBe(ids);
    expect(moveModifierId(ids, "ice", 1)).toEqual(["sugar", "ice"]);
    expect(orderedModifierIds(groups, ["unavailable", "ice"], "common")).toContain("unavailable");
  });
  it("previews shared order and freezes that sequence when choosing custom", () => {
    const onOrderChange = vi.fn(), onModeChange = vi.fn();
    render(<ModifierOrderPicker groups={groups} selectedIds={new Set(["ice", "sugar"])} mode="common"
      onOrderChange={onOrderChange} onModeChange={onModeChange} />);
    expect(screen.getAllByRole("listitem").map(row => row.textContent)).toEqual(["1Mức đường", "2Mức đá"]);
    expect(screen.queryByRole("button", { name: "Đưa Mức đá lên" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thứ tự riêng" }));
    expect([...onOrderChange.mock.calls[0][0]]).toEqual(["sugar", "ice"]);
    expect(onModeChange).toHaveBeenCalledWith("custom");
  });
  it("moves only the selected groups and disables movement at list boundaries", () => {
    const onOrderChange = vi.fn();
    render(<ModifierOrderPicker groups={groups} selectedIds={new Set(["ice", "sugar"])} mode="custom"
      onOrderChange={onOrderChange} onModeChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Đưa Mức đá lên" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Đưa Mức đường xuống" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Đưa Mức đường lên" }));
    expect([...onOrderChange.mock.calls[0][0]]).toEqual(["sugar", "ice"]);
  });
});
