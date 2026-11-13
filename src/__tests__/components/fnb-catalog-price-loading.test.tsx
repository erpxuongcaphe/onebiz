import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import FnbPosPage from "@/app/pos/fnb/page";
import type { FnbProduct } from "@/app/pos/fnb/components/fnb-product-grid";

const fixture = vi.hoisted(() => ({
  branch: "premium",
  toast: vi.fn(),
  reloadCatalog: undefined as (() => void) | undefined,
  readTier: vi.fn(),
  fetch: vi.fn(),
  branches: [
    { id: "premium", name: "Premium", branchType: "store" },
    { id: "dong-xoai", name: "Đồng Xoài", branchType: "store" },
  ],
}));

vi.mock("@/lib/contexts", () => ({
  useAuth: () => ({
    user: null,
    tenant: { id: "test-tenant" },
    branches: fixture.branches,
    currentBranch: fixture.branches.find((branch) => branch.id === fixture.branch),
    isLoading: false,
    hasPermission: () => false,
    switchBranch: vi.fn(),
  }),
  useToast: () => ({ toast: fixture.toast }),
}));
vi.mock("@/lib/contexts/settings-context", () => ({
  useSettings: () => ({ settings: { print: {} } }),
}));
vi.mock("@/components/shared/permission-page", () => ({
  PermissionPage: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/shared/fnb-branch-print-control", () => ({ FnbBranchPrintControl: () => null }));
vi.mock("@/lib/offline/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/offline/db")>(),
  getMeta: async () => undefined,
  setMeta: async () => {},
}));
vi.mock("@/lib/services/supabase/base", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/services/supabase/base")>(),
  getCurrentTenantId: async () => "test-tenant",
}));
vi.mock("@/lib/hooks/use-fnb-pos-layout", () => ({
  useFnbPosLayout: () => ({ layout: { categoryIds: [], productIds: [], hiddenCategoryIds: [], hiddenProductIds: [] } }),
}));
vi.mock("@/lib/hooks/use-fnb-open-orders", () => ({
  useFnbOpenOrders: () => ({ orders: [], refresh: vi.fn(), updatedAt: 0 }),
}));
vi.mock("@/lib/hooks/use-live-data-refresh", () => ({
  useLiveDataRefresh: (refresh: () => void, _tenant: string, _branch: string, tables: string[]) => {
    if (tables.includes("price_tiers")) fixture.reloadCatalog = refresh;
  },
}));
vi.mock("@/lib/services/supabase/pricing", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/services/supabase/pricing")>(),
  resolveAppliedTier: fixture.readTier,
}));
vi.mock("@/lib/services/supabase/products", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/services/supabase/products")>(),
  getProductCategoriesAsync: async () => [{ value: "coffee", label: "Cà phê" }],
}));
vi.mock("@/lib/services/supabase/fnb-menu-order", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/services/supabase/fnb-menu-order")>(),
  readFnbMenuOrderRevision: async () => "revision",
}));
vi.mock("@/lib/services/supabase/fnb-product-branch-menu", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/services/supabase/fnb-product-branch-menu")>(),
  listFnbProductBranchMenuScopes: async () => [],
}));
vi.mock("@/lib/services/supabase/variants", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/services/supabase/variants")>(),
  getVariantsByProduct: async () => [],
  getVariantsByProductIds: async () => [],
}));
vi.mock("@/lib/services/supabase/modifier-groups", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/services/supabase/modifier-groups")>(),
  getEffectiveModifierGroupsForProduct: async () => [],
  listModifierOptionsForGroups: async () => [],
}));
vi.mock("@/lib/offline", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/offline")>(),
  useNetworkStatus: () => ({ isOnline: true }),
  prefetchMenuData: async () => {},
  prefetchTableData: async () => {},
  saveVariantsToCache: async () => {},
}));
vi.mock("@/app/pos/fnb/components/fnb-product-grid", () => ({
  FnbProductGrid: ({ products, onSelectProduct }: {
    products: FnbProduct[];
    onSelectProduct: (product: FnbProduct) => void;
  }) => products.map((product) => (
    <button key={product.id} onClick={() => onSelectProduct(product)}>
      {product.name} {product.sell_price}
    </button>
  )),
}));

const coffee = {
  id: "coffee-product",
  name: "Cà Phê Tươi",
  code: "COFFEE",
  category_id: "coffee",
  inventory_role: "fnb_menu_item",
  sell_price: 22_000,
  stock: 0,
};

function tier(branch: string, price: number) {
  return {
    tierId: branch,
    tierName: branch,
    tierCode: branch,
    priceMap: new Map([[coffee.id, price]]),
    rulesMap: new Map([[coffee.id, [{ variantId: null, minQty: 1, price, createdAt: "" }]]]),
  };
}

function pendingTier() {
  let resolve!: (value: ReturnType<typeof tier> | null) => void;
  const promise = new Promise<ReturnType<typeof tier> | null>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  localStorage.clear();
  fixture.branch = "premium";
  fixture.readTier.mockReset();
  fixture.fetch.mockImplementation(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "test.supabase.co") throw new Error("Unexpected network request in POS test");
    const rows = url.pathname.endsWith("/products_scoped") ? [coffee] : [];
    return Response.json(rows);
  });
  vi.stubGlobal("fetch", fixture.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("publishes the branch price with the menu and adds the item at that price", async () => {
  const prices = pendingTier();
  fixture.readTier.mockReturnValue(prices.promise);
  render(<FnbPosPage />);

  expect(screen.queryByRole("button", { name: "Cà Phê Tươi 22000" })).not.toBeInTheDocument();
  await act(() => prices.resolve(tier("premium", 25_000)));
  fireEvent.click(await screen.findByRole("button", { name: "Cà Phê Tươi 25000" }));
  expect(await screen.findByText("Cà Phê Tươi", { exact: true })).toBeInTheDocument();
  expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({
    title: "+1 Cà Phê Tươi",
    description: expect.stringMatching(/25[.,]000/),
  }));
});

it("keeps the current menu usable during refresh and discards a late price from the previous branch", async () => {
  const oldRefresh = pendingTier();
  fixture.readTier.mockResolvedValueOnce(tier("premium", 25_000))
    .mockReturnValueOnce(oldRefresh.promise)
    .mockResolvedValueOnce(tier("dong-xoai", 29_000));
  const { rerender } = render(<FnbPosPage />);
  expect(await screen.findByRole("button", { name: "Cà Phê Tươi 25000" })).toBeEnabled();
  act(() => fixture.reloadCatalog?.());
  expect(screen.getByRole("button", { name: "Cà Phê Tươi 25000" })).toBeEnabled();

  fixture.branch = "dong-xoai";
  rerender(<FnbPosPage />);
  expect(screen.queryByRole("button", { name: "Cà Phê Tươi 25000" })).not.toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "Cà Phê Tươi 29000" })).toBeEnabled();
  await act(() => oldRefresh.resolve(tier("premium", 26_000)));
  expect(screen.getByRole("button", { name: "Cà Phê Tươi 29000" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Cà Phê Tươi 26000" })).not.toBeInTheDocument();
});

it("retries a failed branch price read without publishing catalog prices", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    fixture.readTier.mockRejectedValueOnce(new Error("price lookup failed"))
      .mockResolvedValueOnce(tier("premium", 25_000));
    render(<FnbPosPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Thử lại" }));
    expect(screen.queryByRole("button", { name: "Cà Phê Tươi 22000" })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Cà Phê Tươi 25000" })).toBeEnabled();
  } finally {
    error.mockRestore();
  }
});
