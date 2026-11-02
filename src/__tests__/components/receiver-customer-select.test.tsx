import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/services/supabase/receiver-contacts", () => ({ getReceiverContacts: m.read }));
import { ReceiverCustomerSelect } from "@/components/shared/receiver-customer-select";
const recipient = { id: "recipient-test", code: "TEST-001", name: "Synthetic recipient", phone: "0000000000", address: "Test address", ward: "Test ward", province: "Test province" };
beforeEach(() => { m.read.mockReset().mockResolvedValue([recipient]); });
afterEach(cleanup);
it("selects a saved recipient with the complete delivery address", async () => {
  const select = vi.fn(); render(<ReceiverCustomerSelect onSelect={select} />);
  fireEvent.change(screen.getByPlaceholderText("Chọn khách đã lưu..."), { target: { value: " recipient " } });
  fireEvent.click(await screen.findByRole("button", { name: /Synthetic recipient/ }));
  expect(select).toHaveBeenCalledExactlyOnceWith(recipient);
  expect(m.read).toHaveBeenCalledWith("recipient", expect.any(AbortSignal));
  expect(screen.queryByRole("button", { name: /Synthetic recipient/ })).not.toBeInTheDocument();
});
it("cancels the previous query and ignores its late response", async () => {
  let finish!: (rows: typeof recipient[]) => void;
  m.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  render(<ReceiverCustomerSelect onSelect={vi.fn()} />);
  const input = screen.getByPlaceholderText("Chọn khách đã lưu...");
  fireEvent.change(input, { target: { value: "Old" } });
  await waitFor(() => expect(m.read).toHaveBeenCalledOnce());
  const oldSignal = m.read.mock.calls[0][1] as AbortSignal;
  fireEvent.change(input, { target: { value: "New" } });
  expect(oldSignal.aborted).toBe(true);
  await act(async () => finish([{ ...recipient, name: "Old result" }]));
  expect(screen.queryByRole("button", { name: /Old result/ })).not.toBeInTheDocument();
  expect(await screen.findByRole("button", { name: /Synthetic recipient/ })).toBeInTheDocument();
});
it("aborts a pending lookup on unmount", async () => {
  m.read.mockReturnValue(new Promise(() => {}));
  const { unmount } = render(<ReceiverCustomerSelect onSelect={vi.fn()} />);
  fireEvent.change(screen.getByPlaceholderText("Chọn khách đã lưu..."), { target: { value: "Test" } });
  await waitFor(() => expect(m.read).toHaveBeenCalledOnce());
  const signal = m.read.mock.calls[0][1] as AbortSignal;
  unmount(); expect(signal.aborted).toBe(true);
});
it("separates a failed lookup from an empty search result", async () => {
  m.read.mockRejectedValue(new Error("Read failed"));
  render(<ReceiverCustomerSelect onSelect={vi.fn()} />);
  fireEvent.change(screen.getByPlaceholderText("Chọn khách đã lưu..."), { target: { value: "Test" } });
  expect(screen.getByRole("status")).toHaveTextContent("Đang tìm");
  expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được người nhận");
  expect(screen.queryByText("Không tìm thấy")).not.toBeInTheDocument();
});
