import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ customers: vi.fn(), suppliers: vi.fn(), products: vi.fn(), legacy: vi.fn(), router: { push: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => mock.router }));
vi.mock("@/lib/hooks/use-unsaved-work", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/hooks/use-unsaved-work")>(), requestPageLeave: (go: () => void) => go() }));
vi.mock("@/lib/services", () => ({ getProducts: mock.products, getCustomers: mock.legacy, getSuppliers: mock.legacy }));
vi.mock("@/lib/services/supabase/counterparty-contacts", () => ({ getCustomerContacts: mock.customers, getSupplierContacts: mock.suppliers }));
import { CommandPaletteProvider, useCommandPalette } from "@/components/shared/command-palette";

function OpenSearch() { const { openPalette } = useCommandPalette(); return <button onClick={openPalette}>Open search</button>; }
beforeEach(() => {
  vi.clearAllMocks();
  mock.products.mockResolvedValue({ data: [], total: 0 });
  mock.customers.mockResolvedValue({ data: [{ id: "customer-a", code: "KH001", name: "Contact Customer", phone: "0900000000", email: null }], total: 1 });
  mock.suppliers.mockResolvedValue({ data: [{ id: "supplier-a", code: "NCC001", name: "Contact Supplier", phone: "0911111111", email: null }], total: 1 });
});
afterEach(cleanup);

it("searches contact directories and keeps customer navigation working", async () => {
  render(<CommandPaletteProvider><OpenSearch /></CommandPaletteProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Open search" }));
  fireEvent.change(screen.getByPlaceholderText("Tìm kiếm sản phẩm, khách hàng, hành động..."), { target: { value: "Contact" } });
  const customer = await screen.findByRole("option", { name: /Contact Customer/ });
  expect(screen.getByRole("option", { name: /Contact Supplier/ })).toHaveTextContent("0911111111");
  expect(mock.customers).toHaveBeenCalledWith({ page: 0, pageSize: 5, search: "Contact" });
  expect(mock.suppliers).toHaveBeenCalledWith({ page: 0, pageSize: 5, search: "Contact" });
  expect(mock.legacy).not.toHaveBeenCalled();
  fireEvent.click(customer);
  expect(mock.router.push).toHaveBeenCalledWith("/khach-hang?focus=customer-a");
});

it("keeps supplier navigation usable when the customer search fails", async () => {
  mock.customers.mockRejectedValue(new Error("Read unavailable"));
  render(<CommandPaletteProvider><OpenSearch /></CommandPaletteProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Open search" }));
  fireEvent.change(screen.getByPlaceholderText("Tìm kiếm sản phẩm, khách hàng, hành động..."), { target: { value: "Contact" } });
  fireEvent.click(await screen.findByRole("option", { name: /Contact Supplier/ }));
  await waitFor(() => expect(mock.router.push).toHaveBeenCalledWith("/hang-hoa/nha-cung-cap?focus=supplier-a"));
  expect(mock.legacy).not.toHaveBeenCalled();
});
