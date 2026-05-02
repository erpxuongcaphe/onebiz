import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { render, screen, fireEvent } from "@testing-library/react";
import { useFnbPosState } from "@/app/pos/fnb/hooks/use-fnb-pos-state";

// ── Mock formatCurrency ──
vi.mock("@/lib/format", () => ({
  formatCurrency: (v: number) => v.toLocaleString("vi-VN"),
}));

// ── Helper: build a line input ──
function makeLine(overrides: Partial<{
  productId: string; productName: string; quantity: number;
  unitPrice: number; variantId: string; note: string;
}> = {}) {
  return {
    productId: overrides.productId ?? "prod-1",
    productName: overrides.productName ?? "Cà phê sữa",
    quantity: overrides.quantity ?? 1,
    unitPrice: overrides.unitPrice ?? 35_000,
    toppings: [],
    note: overrides.note,
    variantId: overrides.variantId,
  };
}

// ============================================================
// A. useFnbPosState — hook logic tests
// ============================================================

describe("useFnbPosState", () => {
  // ── Tab management ──

  it("khởi tạo với 1 tab mặc định", () => {
    const { result } = renderHook(() => useFnbPosState());
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTab).toBeDefined();
    expect(result.current.activeTab!.label).toBe("Mang về #1");
    expect(result.current.activeTab!.orderType).toBe("takeaway");
    expect(result.current.activeTab!.customerName).toBe("Khách lẻ");
  });

  it("tạo tab mới và tự switch sang", () => {
    const { result } = renderHook(() => useFnbPosState());
    const oldId = result.current.activeTabId;

    act(() => {
      result.current.createTab("Bàn 5", "dine_in", "table-5");
    });

    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.activeTabId).not.toBe(oldId);
    expect(result.current.activeTab!.label).toBe("Bàn 5");
    expect(result.current.activeTab!.orderType).toBe("dine_in");
    expect(result.current.activeTab!.tableId).toBe("table-5");
  });

  it("đóng tab cuối cùng → tạo tab fallback", () => {
    const { result } = renderHook(() => useFnbPosState());
    const tabId = result.current.activeTabId;

    act(() => {
      result.current.closeTab(tabId);
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTabId).not.toBe(tabId); // new fallback tab
    expect(result.current.activeTab!.label).toBe("Mang về #1");
  });

  it("switch tab", () => {
    const { result } = renderHook(() => useFnbPosState());

    let secondTabId: string;
    act(() => {
      secondTabId = result.current.createTab("Mang về #2", "takeaway");
    });

    const firstTabId = result.current.tabs[0].id;

    act(() => {
      result.current.switchTab(firstTabId);
    });

    expect(result.current.activeTabId).toBe(firstTabId);
  });

  it("updateTabMeta — cập nhật customer info", () => {
    const { result } = renderHook(() => useFnbPosState());
    const tabId = result.current.activeTabId;

    act(() => {
      result.current.updateTabMeta(tabId, {
        customerId: "cust-123",
        customerName: "Nguyễn Văn A",
      });
    });

    expect(result.current.activeTab!.customerId).toBe("cust-123");
    expect(result.current.activeTab!.customerName).toBe("Nguyễn Văn A");
  });

  // ── Cart lines ──

  it("thêm 1 món → subtotal = unitPrice * qty", () => {
    const { result } = renderHook(() => useFnbPosState());

    act(() => {
      result.current.addLine(makeLine({ unitPrice: 35_000, quantity: 2 }));
    });

    expect(result.current.activeTab!.lines).toHaveLength(1);
    expect(result.current.subtotal).toBe(70_000);
    expect(result.current.lineCount).toBe(2);
  });

  it("thêm cùng món → merge qty thay vì tạo line mới", () => {
    const { result } = renderHook(() => useFnbPosState());

    act(() => {
      result.current.addLine(makeLine({ productId: "p1", quantity: 1, unitPrice: 30_000 }));
    });
    act(() => {
      result.current.addLine(makeLine({ productId: "p1", quantity: 2, unitPrice: 30_000 }));
    });

    expect(result.current.activeTab!.lines).toHaveLength(1);
    expect(result.current.activeTab!.lines[0].quantity).toBe(3);
    expect(result.current.subtotal).toBe(90_000);
  });

  it("thêm khác variant → tạo line riêng", () => {
    const { result } = renderHook(() => useFnbPosState());

    act(() => {
      result.current.addLine(makeLine({ productId: "p1", variantId: "v1", unitPrice: 30_000 }));
    });
    act(() => {
      result.current.addLine(makeLine({ productId: "p1", variantId: "v2", unitPrice: 35_000 }));
    });

    expect(result.current.activeTab!.lines).toHaveLength(2);
  });

  it("updateLineQty — tăng qty", () => {
    const { result } = renderHook(() => useFnbPosState());

    act(() => {
      result.current.addLine(makeLine({ unitPrice: 25_000, quantity: 1 }));
    });

    const lineId = result.current.activeTab!.lines[0].id;
    act(() => {
      result.current.updateLineQty(lineId, 5);
    });

    expect(result.current.activeTab!.lines[0].quantity).toBe(5);
    expect(result.current.subtotal).toBe(125_000);
  });

  it("updateLineQty <= 0 → xoá line", () => {
    const { result } = renderHook(() => useFnbPosState());

    act(() => {
      result.current.addLine(makeLine());
    });

    const lineId = result.current.activeTab!.lines[0].id;
    act(() => {
      result.current.updateLineQty(lineId, 0);
    });

    expect(result.current.activeTab!.lines).toHaveLength(0);
    expect(result.current.subtotal).toBe(0);
  });

  it("removeLine", () => {
    const { result } = renderHook(() => useFnbPosState());

    act(() => {
      result.current.addLine(makeLine({ productId: "p1" }));
      result.current.addLine(makeLine({ productId: "p2", unitPrice: 40_000 }));
    });

    const lineId = result.current.activeTab!.lines[0].id;
    act(() => {
      result.current.removeLine(lineId);
    });

    expect(result.current.activeTab!.lines).toHaveLength(1);
    expect(result.current.activeTab!.lines[0].productId).toBe("p2");
  });

  it("clearCart → empty lines", () => {
    const { result } = renderHook(() => useFnbPosState());

    act(() => {
      result.current.addLine(makeLine());
      result.current.addLine(makeLine({ productId: "p2" }));
    });
    act(() => {
      result.current.clearCart();
    });

    expect(result.current.activeTab!.lines).toHaveLength(0);
    expect(result.current.subtotal).toBe(0);
  });

  it("toppings tính vào lineTotal", () => {
    const { result } = renderHook(() => useFnbPosState());

    act(() => {
      result.current.addLine({
        productId: "p1",
        productName: "Trà sữa",
        quantity: 2,
        unitPrice: 30_000,
        toppings: [
          { productId: "top1", name: "Trân châu", quantity: 1, price: 5_000 },
          { productId: "top2", name: "Pudding", quantity: 1, price: 7_000 },
        ],
      });
    });

    // lineTotal = (30000 * 2) + (5000 * 1 * 2) + (7000 * 1 * 2) = 60000 + 10000 + 14000 = 84000
    expect(result.current.activeTab!.lines[0].lineTotal).toBe(84_000);
    expect(result.current.subtotal).toBe(84_000);
  });

  // ── Discount ──

  it("setOrderDiscount amount mode — giảm cố định", () => {
    const { result } = renderHook(() => useFnbPosState());

    act(() => {
      result.current.addLine(makeLine({ unitPrice: 50_000, quantity: 2 }));
    });
    expect(result.current.subtotal).toBe(100_000);

    act(() => {
      result.current.setOrderDiscount(result.current.activeTabId, {
        mode: "amount",
        value: 15_000,
      });
    });

    expect(result.current.orderDiscountAmount).toBe(15_000);
    expect(result.current.total).toBe(85_000);
  });

  it("setOrderDiscount percent mode — giảm %", () => {
    const { result } = renderHook(() => useFnbPosState());

    act(() => {
      result.current.addLine(makeLine({ unitPrice: 40_000, quantity: 5 }));
    });
    expect(result.current.subtotal).toBe(200_000);

    act(() => {
      result.current.setOrderDiscount(result.current.activeTabId, {
        mode: "percent",
        value: 10,
      });
    });

    expect(result.current.orderDiscountAmount).toBe(20_000);
    expect(result.current.total).toBe(180_000);
  });

  it("discount amount > subtotal → capped tại subtotal", () => {
    const { result } = renderHook(() => useFnbPosState());

    act(() => {
      result.current.addLine(makeLine({ unitPrice: 30_000, quantity: 1 }));
    });

    act(() => {
      result.current.setOrderDiscount(result.current.activeTabId, {
        mode: "amount",
        value: 999_999,
      });
    });

    expect(result.current.orderDiscountAmount).toBe(30_000);
    expect(result.current.total).toBe(0);
  });

  it("discount percent > 100 → capped tại 100%", () => {
    const { result } = renderHook(() => useFnbPosState());

    act(() => {
      result.current.addLine(makeLine({ unitPrice: 50_000, quantity: 1 }));
    });

    act(() => {
      result.current.setOrderDiscount(result.current.activeTabId, {
        mode: "percent",
        value: 150,
      });
    });

    expect(result.current.orderDiscountAmount).toBe(50_000);
    expect(result.current.total).toBe(0);
  });

  it("setOrderDiscount undefined → xoá giảm giá", () => {
    const { result } = renderHook(() => useFnbPosState());

    act(() => {
      result.current.addLine(makeLine({ unitPrice: 50_000, quantity: 1 }));
    });
    act(() => {
      result.current.setOrderDiscount(result.current.activeTabId, {
        mode: "amount",
        value: 10_000,
      });
    });
    expect(result.current.total).toBe(40_000);

    act(() => {
      result.current.setOrderDiscount(result.current.activeTabId, undefined);
    });

    expect(result.current.orderDiscountAmount).toBe(0);
    expect(result.current.total).toBe(50_000);
  });

  it("discount percent value 0 → không giảm", () => {
    const { result } = renderHook(() => useFnbPosState());

    act(() => {
      result.current.addLine(makeLine({ unitPrice: 50_000, quantity: 1 }));
    });
    act(() => {
      result.current.setOrderDiscount(result.current.activeTabId, {
        mode: "percent",
        value: 0,
      });
    });

    expect(result.current.orderDiscountAmount).toBe(0);
    expect(result.current.total).toBe(50_000);
  });

  it("discount không ảnh hưởng tab khác", () => {
    const { result } = renderHook(() => useFnbPosState());
    const tab1Id = result.current.activeTabId;

    act(() => {
      result.current.addLine(makeLine({ unitPrice: 50_000, quantity: 1 }));
    });
    act(() => {
      result.current.setOrderDiscount(tab1Id, { mode: "amount", value: 10_000 });
    });

    // Create second tab + add item
    act(() => {
      result.current.createTab("Bàn 3", "dine_in");
    });
    act(() => {
      result.current.addLine(makeLine({ unitPrice: 60_000, quantity: 1 }));
    });

    // Tab 2 should have no discount
    expect(result.current.orderDiscountAmount).toBe(0);
    expect(result.current.total).toBe(60_000);

    // Switch back to tab 1 → discount still there
    act(() => {
      result.current.switchTab(tab1Id);
    });
    expect(result.current.orderDiscountAmount).toBe(10_000);
    expect(result.current.total).toBe(40_000);
  });

  // ── Lines scoped to active tab ──

  it("addLine chỉ thêm vào tab đang active", () => {
    const { result } = renderHook(() => useFnbPosState());
    const tab1Id = result.current.activeTabId;

    act(() => {
      result.current.addLine(makeLine({ productId: "p1" }));
    });

    act(() => {
      result.current.createTab("Tab 2", "takeaway");
    });
    act(() => {
      result.current.addLine(makeLine({ productId: "p2" }));
    });

    // Tab 2 active → 1 line
    expect(result.current.activeTab!.lines).toHaveLength(1);
    expect(result.current.activeTab!.lines[0].productId).toBe("p2");

    // Tab 1 → 1 line (unchanged)
    const tab1 = result.current.tabs.find((t) => t.id === tab1Id)!;
    expect(tab1.lines).toHaveLength(1);
    expect(tab1.lines[0].productId).toBe("p1");
  });
});

// ============================================================
// B. FnbCart — component render tests
// ============================================================

// We need to mock UI components that FnbCart uses
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));
vi.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

// Must import AFTER mocks
const { FnbCart } = await import("@/app/pos/fnb/components/fnb-cart");
const { FnbPaymentDialog } = await import("@/app/pos/fnb/components/fnb-payment-dialog");

describe("FnbCart — component", () => {
  const baseTab = {
    id: "tab-1",
    label: "Mang về #1",
    orderType: "takeaway" as const,
    customerName: "Khách lẻ",
    lines: [] as any[],
  };

  const noop = () => {};

  const baseProps = {
    activeTab: baseTab,
    subtotal: 0,
    total: 0,
    orderDiscountAmount: 0,
    lineCount: 0,
    updateLineQty: noop,
    removeLine: noop,
    onSendToKitchen: noop,
    onPayment: noop,
  };

  it("hiện 'Chưa có món nào' khi cart trống", () => {
    render(<FnbCart {...baseProps} />);
    expect(screen.getByText("Chưa có món nào")).toBeDefined();
  });

  it("hiện customer bar với tên khách", () => {
    render(
      <FnbCart
        {...baseProps}
        activeTab={{ ...baseTab, customerName: "Nguyễn Văn B" }}
        onCustomerClick={noop}
      />
    );
    expect(screen.getByText("Nguyễn Văn B")).toBeDefined();
    expect(screen.getByText("F4")).toBeDefined();
  });

  it("hiện nút 'Bếp (F10)' + 'Thanh toán (F9)'", () => {
    render(<FnbCart {...baseProps} />);
    // Label gộp hotkey vào trong text (compact 40/60 split per Stitch)
    expect(screen.getByText("Bếp (F10)")).toBeDefined();
    expect(screen.getByText("Thanh toán (F9)")).toBeDefined();
  });

  it("đơn đã gửi bếp → nút chuyển thành 'Gửi thêm (F10)'", () => {
    render(
      <FnbCart
        {...baseProps}
        activeTab={{ ...baseTab, kitchenOrderId: "ko-1" }}
      />
    );
    expect(screen.getByText("Gửi thêm (F10)")).toBeDefined();
  });

  it("hiện subtotal và total", () => {
    render(
      <FnbCart {...baseProps} subtotal={100_000} total={100_000} />
    );
    expect(screen.getByText("Tạm tính")).toBeDefined();
    expect(screen.getByText("Khách cần trả")).toBeDefined();
  });

  it("hiện dòng giảm giá khi orderDiscountAmount > 0", () => {
    render(
      <FnbCart
        {...baseProps}
        subtotal={100_000}
        total={85_000}
        orderDiscountAmount={15_000}
      />
    );
    expect(screen.getByText("Giảm giá")).toBeDefined();
  });

  it("ẩn dòng giảm giá khi orderDiscountAmount = 0", () => {
    render(<FnbCart {...baseProps} subtotal={100_000} total={100_000} orderDiscountAmount={0} />);
    expect(screen.queryByText("Giảm giá")).toBeNull();
  });

  it("mobile=true → hiện trên mọi viewport (không có class hidden độc lập)", () => {
    const { container } = render(<FnbCart {...baseProps} mobile />);
    const rootDiv = container.firstElementChild as HTMLElement;
    const classes = rootDiv.className.split(/\s+/);
    expect(classes).toContain("w-full");
    // Không có class "hidden" độc lập (vẫn cho phép "overflow-hidden")
    expect(classes).not.toContain("hidden");
    expect(classes).not.toContain("lg:flex");
  });

  it("mobile=false (default) → hidden md:flex (visible on tablet+)", () => {
    const { container } = render(<FnbCart {...baseProps} />);
    const rootDiv = container.firstElementChild as HTMLElement;
    const classes = rootDiv.className.split(/\s+/);
    expect(classes).toContain("hidden");
    // Sprint POLISH-1.4: cart hiện từ md (768) thay vì lg để iPad portrait
    // có cart context bên cạnh menu thay vì phải mở overlay full-screen.
    expect(classes).toContain("md:flex");
  });

  it("click customer bar → gọi onCustomerClick", () => {
    const spy = vi.fn();
    render(<FnbCart {...baseProps} onCustomerClick={spy} />);

    fireEvent.click(screen.getByText("Khách lẻ"));
    expect(spy).toHaveBeenCalledOnce();
  });

  it("hiện cart lines khi có sản phẩm", () => {
    const tabWithLines = {
      ...baseTab,
      lines: [
        {
          id: "line-1",
          productId: "p1",
          productName: "Cà phê sữa",
          quantity: 2,
          unitPrice: 35_000,
          toppings: [],
          lineTotal: 70_000,
        },
      ],
    };

    render(
      <FnbCart
        {...baseProps}
        activeTab={tabWithLines}
        subtotal={70_000}
        total={70_000}
        lineCount={2}
      />
    );

    expect(screen.getByText("Cà phê sữa")).toBeDefined();
    expect(screen.getByText("2 món")).toBeDefined();
  });

  it("hiện discount input khi có món và onDiscountChange", () => {
    const tabWithLines = {
      ...baseTab,
      lines: [
        {
          id: "line-1",
          productId: "p1",
          productName: "Trà đào",
          quantity: 1,
          unitPrice: 30_000,
          toppings: [],
          lineTotal: 30_000,
        },
      ],
    };

    render(
      <FnbCart
        {...baseProps}
        activeTab={tabWithLines}
        subtotal={30_000}
        total={30_000}
        lineCount={1}
        onDiscountChange={noop}
      />
    );

    // Should see the discount row with input
    const inputs = screen.getAllByPlaceholderText("0");
    expect(inputs.length).toBeGreaterThan(0);
  });
});

// ============================================================
// C. FnbPaymentDialog — component render tests
// ============================================================

// Mock Dialog components
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: React.ComponentProps<"label">) => <label {...props}>{children}</label>,
}));

describe("FnbPaymentDialog — component", () => {
  const baseProps = {
    open: true,
    onOpenChange: vi.fn(),
    subtotal: 200_000,
    total: 200_000,
    lineCount: 3,
    onConfirm: vi.fn(),
  };

  it("hiện order summary: Tạm tính + Tổng cộng", () => {
    render(<FnbPaymentDialog {...baseProps} />);
    expect(screen.getByText("Tạm tính")).toBeDefined();
    expect(screen.getByText("Tổng cộng")).toBeDefined();
  });

  it("hiện giảm giá khi discountAmount > 0", () => {
    render(
      <FnbPaymentDialog
        {...baseProps}
        subtotal={200_000}
        discountAmount={20_000}
        total={180_000}
      />
    );
    expect(screen.getByText("Giảm giá")).toBeDefined();
  });

  it("ẩn giảm giá khi discountAmount = 0", () => {
    render(<FnbPaymentDialog {...baseProps} discountAmount={0} />);
    expect(screen.queryByText("Giảm giá")).toBeNull();
  });

  it("hiện 4 phương thức thanh toán", () => {
    render(<FnbPaymentDialog {...baseProps} />);
    expect(screen.getByText("Tiền mặt")).toBeDefined();
    expect(screen.getByText("Chuyển khoản")).toBeDefined();
    expect(screen.getByText("Thẻ")).toBeDefined();
    expect(screen.getByText("Hỗn hợp")).toBeDefined();
  });

  it("hiện denomination buttons: Đủ, 50k, 100k, 200k, 500k, 1M", () => {
    render(<FnbPaymentDialog {...baseProps} />);
    expect(screen.getByText("Đủ")).toBeDefined();
    expect(screen.getByText("50k")).toBeDefined();
    expect(screen.getByText("100k")).toBeDefined();
    expect(screen.getByText("200k")).toBeDefined();
    expect(screen.getByText("500k")).toBeDefined();
    expect(screen.getByText("1M")).toBeDefined();
  });

  it("click 'Đủ' → điền chính xác tổng tiền", () => {
    render(<FnbPaymentDialog {...baseProps} total={185_000} />);

    fireEvent.click(screen.getByText("Đủ"));

    // After clicking "Đủ", the cash input should be 185000
    const cashInput = screen.getByPlaceholderText("0") as HTMLInputElement;
    expect(cashInput.value).toBe("185000");
  });

  it("click denomination 100k → điền 100000", () => {
    render(<FnbPaymentDialog {...baseProps} />);

    fireEvent.click(screen.getByText("100k"));

    const cashInput = screen.getByPlaceholderText("0") as HTMLInputElement;
    expect(cashInput.value).toBe("100000");
  });

  it("confirm button hiện tổng tiền (total, không phải subtotal)", () => {
    render(
      <FnbPaymentDialog
        {...baseProps}
        subtotal={200_000}
        discountAmount={20_000}
        total={180_000}
      />
    );

    // Button text should include total (180000), not subtotal (200000)
    const confirmBtn = screen.getByRole("button", { name: /Hoàn tất thanh toán/i });
    expect(confirmBtn.textContent).toContain("180");
  });

  it("transfer method → tự động set paid = total, không hiện denomination", () => {
    render(<FnbPaymentDialog {...baseProps} total={150_000} />);

    // Switch to transfer
    fireEvent.click(screen.getByText("Chuyển khoản"));

    // Denomination buttons should not be visible (cash input hidden)
    expect(screen.queryByText("Đủ")).toBeNull();
    expect(screen.queryByText("50k")).toBeNull();
  });

  it("hiện order number trong title khi có", () => {
    render(<FnbPaymentDialog {...baseProps} orderNumber="Bàn 5" />);
    expect(screen.getByText("Thanh toán — Bàn 5")).toBeDefined();
  });

  it("dialog ẩn khi open=false", () => {
    render(<FnbPaymentDialog {...baseProps} open={false} />);
    expect(screen.queryByTestId("dialog")).toBeNull();
  });
});
