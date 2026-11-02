import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const api = vi.hoisted(() => ({ customers: vi.fn(), suppliers: vi.fn(), customerAdvance: vi.fn(), supplierAdvance: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/services/supabase/counterparty-contacts", () => ({ getCustomerContacts: api.customers, getSupplierContacts: api.suppliers }));
vi.mock("@/lib/services/supabase/payments", () => ({ recordCustomerAdvance: api.customerAdvance, recordSupplierAdvance: api.supplierAdvance }));
vi.mock("@/lib/contexts", () => ({ useToast: () => ({ toast: api.toast }) }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/money-account-select", () => ({
  MoneyAccountSelect: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <input aria-label="Test money account" value={value} onChange={event => onChange(event.target.value)} />,
}));

import { RecordAdvanceDialog } from "@/components/shared/dialogs/record-advance-dialog";

const contact = { id: "party-test", code: "TEST-001", name: "Synthetic party", phone: "0000000000", email: null };
beforeEach(() => {
  vi.resetAllMocks();
  api.customers.mockResolvedValue({ data: [contact], total: 1 });
  api.suppliers.mockResolvedValue({ data: [contact], total: 1 });
  api.customerAdvance.mockResolvedValue({ cashCode: "TEST-RECEIPT", advanceAmount: 125000 });
  api.supplierAdvance.mockResolvedValue({ cashCode: "TEST-PAYMENT", advanceAmount: 125000 });
});
afterEach(cleanup);

describe("advance contact selection", () => {
  it.each(["customer", "supplier"] as const)("selects a %s contact and retains explicit payment details", async mode => {
    const onSuccess = vi.fn();
    render(<RecordAdvanceDialog open mode={mode} branchId="branch-test" onOpenChange={vi.fn()} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByPlaceholderText(/Tìm theo mã, tên hoặc SĐT/), { target: { value: " Synthetic " } });
    fireEvent.click(await screen.findByRole("button", { name: /Synthetic party/ }));
    const read = mode === "customer" ? api.customers : api.suppliers;
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ page: 0, pageSize: 8, search: "Synthetic", sortBy: "name", sortOrder: "asc", signal: expect.any(AbortSignal) }));
    expect(mode === "customer" ? api.suppliers : api.customers).not.toHaveBeenCalled();
    expect(api.customerAdvance).not.toHaveBeenCalled();
    expect(api.supplierAdvance).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText("Nhập số tiền trả trước"), { target: { value: "125000" } });
    fireEvent.change(screen.getByLabelText("Test money account"), { target: { value: "account-test" } });
    fireEvent.change(screen.getByPlaceholderText(mode === "customer" ? "VD: Khách đặt cọc đơn tháng 9" : "VD: Ứng trước lô nguyên liệu tháng 9"), { target: { value: "Synthetic advance reason" } });
    fireEvent.click(screen.getByRole("button", { name: mode === "customer" ? "Ghi nhận tiền cọc" : "Ghi nhận ứng trước" }));
    const write = mode === "customer" ? api.customerAdvance : api.supplierAdvance;
    await waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ partyId: contact.id, branchId: "branch-test", amount: 125000, paymentMethod: "transfer", moneyAccountId: "account-test", note: "Synthetic advance reason" }));
    expect(mode === "customer" ? api.supplierAdvance : api.customerAdvance).not.toHaveBeenCalled();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
  });

  it("aborts a pending lookup when closed and ignores its late result", async () => {
    let finish!: (value: { data: typeof contact[]; total: number }) => void;
    api.customers.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const props = { mode: "customer" as const, branchId: "branch-test", onOpenChange: vi.fn() };
    const { rerender } = render(<RecordAdvanceDialog {...props} open />);
    fireEvent.change(screen.getByPlaceholderText(/Tìm theo mã, tên hoặc SĐT/), { target: { value: "Synthetic" } });
    await waitFor(() => expect(api.customers).toHaveBeenCalledOnce());
    const signal = api.customers.mock.calls[0][0].signal as AbortSignal;
    rerender(<RecordAdvanceDialog {...props} open={false} />);
    expect(signal.aborted).toBe(true);
    finish({ data: [contact], total: 1 });
    rerender(<RecordAdvanceDialog {...props} open />);
    expect(screen.queryByRole("button", { name: /Synthetic party/ })).not.toBeInTheDocument();
    expect(api.customerAdvance).not.toHaveBeenCalled();
  });

  it("does not search when a caller already supplied the selected party", () => {
    render(<RecordAdvanceDialog open mode="customer" partyId={contact.id} partyName={contact.name} branchId="branch-test" onOpenChange={vi.fn()} />);
    expect(screen.getByText(contact.name)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Tìm theo mã, tên hoặc SĐT/)).not.toBeInTheDocument();
    expect(api.customers).not.toHaveBeenCalled();
    expect(api.suppliers).not.toHaveBeenCalled();
  });

  it("keeps saving disabled without a concrete branch", () => {
    render(<RecordAdvanceDialog open mode="supplier" partyId={contact.id} partyName={contact.name} branchId={null} onOpenChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Ghi nhận ứng trước" })).toBeDisabled();
    expect(api.supplierAdvance).not.toHaveBeenCalled();
  });

  it("clears a customer selection when the dialog changes to supplier advances", async () => {
    const props = { open: true, branchId: "branch-test", onOpenChange: vi.fn() };
    const { rerender } = render(<RecordAdvanceDialog {...props} mode="customer" />);
    fireEvent.change(screen.getByPlaceholderText(/Tìm theo mã, tên hoặc SĐT/), { target: { value: "Synthetic" } });
    fireEvent.click(await screen.findByRole("button", { name: /Synthetic party/ }));
    expect(screen.getByText(contact.name)).toBeInTheDocument();
    rerender(<RecordAdvanceDialog {...props} mode="supplier" />);
    expect(screen.queryByText(contact.name)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Tìm theo mã, tên hoặc SĐT nhà cung cấp")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Ghi nhận ứng trước" }));
    expect(screen.getByText("Hãy chọn nhà cung cấp nhận tiền ứng trước")).toBeInTheDocument();
    expect(api.supplierAdvance).not.toHaveBeenCalled();
  });

  it("ignores a pending customer response after switching to supplier mode", async () => {
    let finish!: (value: { data: typeof contact[]; total: number }) => void;
    api.customers.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const props = { open: true, branchId: "branch-test", onOpenChange: vi.fn() };
    const { rerender } = render(<RecordAdvanceDialog {...props} mode="customer" />);
    fireEvent.change(screen.getByPlaceholderText(/Tìm theo mã, tên hoặc SĐT/), { target: { value: "Synthetic" } });
    await waitFor(() => expect(api.customers).toHaveBeenCalledOnce());
    const signal = api.customers.mock.calls[0][0].signal as AbortSignal;
    rerender(<RecordAdvanceDialog {...props} mode="supplier" />);
    expect(signal.aborted).toBe(true);
    finish({ data: [contact], total: 1 });
    await waitFor(() => expect(screen.getByPlaceholderText("Tìm theo mã, tên hoặc SĐT nhà cung cấp")).toHaveValue(""));
    expect(screen.queryByRole("button", { name: /Synthetic party/ })).not.toBeInTheDocument();
    expect(api.customerAdvance).not.toHaveBeenCalled();
    expect(api.supplierAdvance).not.toHaveBeenCalled();
  });
});
