import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FnbChangeDeliveryDialog } from "@/app/pos/fnb/components/fnb-change-delivery-dialog";
import { DEFAULT_DELIVERY_PLATFORM_SETTINGS } from "@/lib/services/supabase/fnb-platform-settings";

const policy = {
  revision: 7,
  enabled: true,
  amountBasis: "after_discount",
  rules: [
    { id: "free", name: "Từ 50.000đ", fromMeters: 1000, toMeters: 3001, fromAmount: 50000, toAmount: null, fee: 0, enabled: true },
    { id: "paid", name: "Dưới 50.000đ", fromMeters: 1000, toMeters: 3001, fromAmount: 0, toAmount: 50000, fee: 10000, enabled: true },
  ],
} as const;

function renderDialog() {
  const onConfirm = vi.fn();
  render(<FnbChangeDeliveryDialog policy={{ ...policy, rules: [...policy.rules] }} policyError="" onRetryPolicy={vi.fn()}
    settings={DEFAULT_DELIVERY_PLATFORM_SETTINGS} before={60000} after={49000} tiers={[]} busy={false}
    onClose={vi.fn()} onConfirm={onConfirm} />);
  return { onConfirm, submit: screen.getByRole("button", { name: "Chuyển sang giao hàng" }) };
}

describe("F&B change to delivery", () => {
  it("requires a distance and uses the branch fee after discount", () => {
    const { onConfirm, submit } = renderDialog();
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /1 km/ }));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({ platform: "direct", fee: 10000, tier: "custom", policyRevision: 7 });
  });

  it("keeps a platform order separate from the branch self-delivery tariff", () => {
    const { onConfirm, submit } = renderDialog();
    fireEvent.change(screen.getByRole("combobox", { name: "Sàn giao hàng" }), { target: { value: "grab_food" } });
    fireEvent.click(submit);
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({ platform: "grab_food", fee: 0, tier: undefined, policyRevision: undefined });
  });
});
