import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoSaveDraft } from "@/app/pos/hooks/use-auto-save-draft";
import { usePosState, type OrderLine } from "@/app/pos/hooks/use-pos-state";
import type { DraftOrderDetail } from "@/lib/services/supabase";

const serviceMocks = vi.hoisted(() => ({
  saveDraftOrder: vi.fn(),
  deleteDraftOrder: vi.fn(),
}));

vi.mock("@/lib/services/supabase", () => ({
  saveDraftOrder: serviceMocks.saveDraftOrder,
  deleteDraftOrder: serviceMocks.deleteDraftOrder,
}));

const context = {
  tenantId: "tenant-1",
  branchId: "branch-1",
  userId: "user-1",
};

function line(productId: string, productName: string): OrderLine {
  return {
    lineId: "line-" + productId,
    productId,
    productCode: productId,
    productName,
    unit: "Cái",
    availableStock: 10,
    stockKnown: true,
    quantity: 1,
    unitPrice: 100,
    vatRate: 0,
    discount: { mode: "amount", value: 0 },
  };
}

function autoSaveProps(
  sessionId: string,
  invoiceId: string,
  productId: string,
) {
  const lines = [line(productId, "Sản phẩm " + productId)];
  return {
    sessionId,
    snapshot: {
      lines,
      customer: null,
      orderDiscount: { mode: "amount" as const, value: 0 },
      paymentMethod: "cash" as const,
      subtotal: 100,
      total: 100,
      orderDiscountAmount: 0,
      lineDiscountTotal: 0,
      shippingFee: 0,
      orderVatRate: 0,
      note: "",
      computeLineTotal: () => 100,
    },
    ctx: context,
    enabled: true,
    draftId: invoiceId,
    draftRevision: 1,
  };
}

describe("POS multi-tab isolation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    serviceMocks.saveDraftOrder.mockReset();
    serviceMocks.deleteDraftOrder.mockReset();
    serviceMocks.deleteDraftOrder.mockResolvedValue(undefined);
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the server draft identity attached to its own session during a slow save", async () => {
    let finishFirst!: (value: { invoiceId: string; revision: number }) => void;
    const firstSave = new Promise<{ invoiceId: string; revision: number }>(
      (resolve) => {
        finishFirst = resolve;
      },
    );

    serviceMocks.saveDraftOrder
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValueOnce({ invoiceId: "invoice-b", revision: 2 });

    const { rerender } = renderHook(
      (props: ReturnType<typeof autoSaveProps>) => {
        useAutoSaveDraft(props);
      },
      { initialProps: autoSaveProps("session-a", "invoice-a", "a") },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(401);
    });
    expect(serviceMocks.saveDraftOrder).toHaveBeenCalledTimes(1);

    rerender(autoSaveProps("session-b", "invoice-b", "b"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(401);
    });
    expect(serviceMocks.saveDraftOrder).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishFirst({ invoiceId: "invoice-a", revision: 2 });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(serviceMocks.saveDraftOrder).toHaveBeenCalledTimes(2);
    expect(serviceMocks.saveDraftOrder.mock.calls[0][1]).toMatchObject({
      sessionId: "session-a",
      invoiceId: "invoice-a",
      expectedRevision: 1,
    });
    expect(serviceMocks.saveDraftOrder.mock.calls[1][1]).toMatchObject({
      sessionId: "session-b",
      invoiceId: "invoice-b",
      expectedRevision: 1,
    });
  });

  it("resets payment and delivery fields when loading another order", () => {
    const { result } = renderHook(() => usePosState());

    act(() => {
      result.current.setPaymentMethod("mixed");
      result.current.setPaid(999);
      result.current.setPaymentBreakdown([
        { method: "cash", amount: 500 },
        { method: "transfer", amount: 499 },
        { method: "card", amount: 0 },
      ]);
      result.current.setSellingMode("delivery");
      result.current.setDeliveryInfo({
        recipientName: "Khách cũ",
        recipientPhone: "0900000000",
        address: "Địa chỉ cũ",
        ward: "",
        district: "",
        shippingFee: 50,
        deliveryNote: "Giao cũ",
        codEnabled: false,
      });
      result.current.setOrderVatRate(10);
    });

    const draft: DraftOrderDetail = {
      id: "order-b",
      code: "DH000002",
      revision: 7,
      source: "order",
      branchId: "branch-1",
      customerId: "customer-b",
      customerName: "Xưởng Bửu Hòa",
      total: 100,
      subtotal: 100,
      discountAmount: 0,
      itemCount: 1,
      note: null,
      createdAt: new Date().toISOString(),
      deliveryFee: 0,
      items: [
        {
          id: "item-b",
          productId: "product-b",
          productName: "Sản phẩm B",
          unit: "Cái",
          quantity: 1,
          unitPrice: 100,
          discount: 0,
          total: 100,
        },
      ],
    };

    act(() => {
      result.current.loadDraft(draft);
    });

    expect(result.current.customer?.name).toBe("Xưởng Bửu Hòa");
    expect(result.current.paymentMethod).toBe("cash");
    expect(result.current.paid).toBe(0);
    expect(result.current.breakdownTotal).toBe(0);
    expect(result.current.sellingMode).toBe("normal");
    expect(result.current.deliveryInfo.shippingFee).toBe(0);
    expect(result.current.orderVatRate).toBe(0);
    expect(result.current.loadedDraftId).toBe("order-b");
    expect(result.current.loadedDraftRevision).toBe(7);
    expect(result.current.loadedDraftSource).toBe("order");

    const snapshot = result.current.getSnapshot();
    act(() => {
      result.current.clearCart();
      result.current.restoreSnapshot(snapshot);
    });
    expect(result.current.loadedDraftId).toBe("order-b");
    expect(result.current.loadedDraftRevision).toBe(7);
    expect(result.current.loadedDraftSource).toBe("order");
    expect(result.current.customer?.name).toBe("Xưởng Bửu Hòa");
  });
});