"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  LogOut,
  Minus,
  Plus,
  Printer,
  ShoppingCart,
  Store,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import { fetchBranches, fetchCurrentBranchId, setMyBranch } from "@/lib/branches";
import { fetchInventoryWarehouses } from "@/lib/inventory";
import {
  createPosSale,
  fetchCatalogForWarehouse,
  fetchOpenShift,
  fetchPosOrder,
  fetchPosOrderItems,
  openShift,
  type PosCatalogItem,
} from "@/lib/pos";

type CartLine = {
  item: PosCatalogItem;
  qty: number;
};

type ReceiptData = {
  orderNumber: string;
  createdAt: string;
  items: Array<{ sku: string; name: string; qty: number; price: number }>
  total: number;
  paymentMethod: string;
  paymentAmount: number;
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("vi-VN").format(value) + "đ";
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

export default function POSQuickSalePage() {
  const router = useRouter();
  const { user, can, loading } = useAuth();

  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [branchId, setBranchId] = useState("");
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string; branch_id?: string | null }>>([]);
  const [warehouseId, setWarehouseId] = useState("");

  const [catalog, setCatalog] = useState<PosCatalogItem[] | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");

  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank_transfer" | "card" | "momo" | "zalopay" | "other">("cash");

  const [shiftId, setShiftId] = useState<string | null>(null);
  const [openingCash, setOpeningCash] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [b, current, w] = await Promise.all([
        fetchBranches(),
        fetchCurrentBranchId(),
        fetchInventoryWarehouses(),
      ]);
      if (!mounted) return;
      setBranches(b.map((x) => ({ id: x.id, name: x.name })));
      setWarehouses(w);
      setBranchId(current ?? b[0]?.id ?? "");
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!branchId) return;
    const first = warehouses.find((w) => (w.branch_id ?? null) === branchId) ?? warehouses[0];
    if (first && !warehouseId) setWarehouseId(first.id);
  }, [branchId, warehouses, warehouseId]);

  useEffect(() => {
    if (!branchId) return;
    void fetchOpenShift(branchId).then((s) => setShiftId(s?.id ?? null));
  }, [branchId]);

  useEffect(() => {
    let mounted = true;
    if (!warehouseId) {
      setCatalog([]);
      return;
    }
    setCatalog(null);
    fetchCatalogForWarehouse({ warehouseId, search, category }).then((data) => {
      if (!mounted) return;
      setCatalog(data);
    });
    return () => {
      mounted = false;
    };
  }, [warehouseId, search, category]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const i of catalog ?? []) set.add(i.category);
    return Array.from(set);
  }, [catalog]);

  const total = useMemo(() => cart.reduce((acc, l) => acc + l.qty * l.item.price, 0), [cart]);

  const addToCart = (item: PosCatalogItem) => {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.item.product_id === item.product_id);
      if (idx === -1) return [...prev, { item, qty: 1 }];
      const next = [...prev];
      next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
      return next;
    });
  };

  const setQty = (productId: string, qty: number) => {
    setCart((prev) =>
      prev
        .map((l) => (l.item.product_id === productId ? { ...l, qty } : l))
        .filter((l) => l.qty > 0)
    );
  };

  const handlePrint = (data: ReceiptData, title: string) => {
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) return;
    const rows = data.items
      .map((i) => `<tr><td>${i.sku}</td><td>${i.name}</td><td>${i.qty}</td><td>${formatCurrency(i.price)}</td></tr>`)
      .join("");
    const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    h1 { font-size: 16px; margin: 0 0 4px; }
    .meta { font-size: 12px; color: #555; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ddd; padding: 6px; font-size: 12px; }
    th { background: #f6f6f6; text-align: left; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="meta">Số: ${data.orderNumber} | ${formatDateTime(data.createdAt)}</div>
  <table>
    <thead><tr><th>SKU</th><th>Tên</th><th>SL</th><th>Giá</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="meta">Tổng: ${formatCurrency(data.total)} | Thanh toán: ${data.paymentMethod}</div>
</body>
</html>`;
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };

  const buildReceiptFromCart = (): ReceiptData => {
    return {
      orderNumber: "TAM-TINH",
      createdAt: new Date().toISOString(),
      items: cart.map((l) => ({
        sku: l.item.sku,
        name: l.item.name,
        qty: l.qty,
        price: l.item.price,
      })),
      total,
      paymentMethod,
      paymentAmount: total,
    };
  };

  const handleCheckout = async () => {
    setError(null);
    if (!shiftId) {
      setError("Chưa mở ca.");
      return;
    }
    if (!branchId || !warehouseId) {
      setError("Chưa chọn chi nhánh/kho.");
      return;
    }
    if (cart.length === 0) return;
    setBusy(true);
    try {
      const orderId = await createPosSale({
        branchId,
        warehouseId,
        shiftId,
        lines: cart.map((l) => ({
          product_id: l.item.product_id,
          quantity: l.qty,
          unit_price: l.item.price,
        })),
        paymentMethod,
        paymentAmount: total,
      });
      if (!orderId) {
        setError("Không thanh toán được (kiểm tra quyền/tồn kho).");
        return;
      }
      const [order, items] = await Promise.all([
        fetchPosOrder(orderId),
        fetchPosOrderItems(orderId),
      ]);
      if (order) {
        setReceipt({
          orderNumber: order.order_number,
          createdAt: order.created_at,
          items: items.map((i) => ({ sku: i.sku, name: i.name, qty: i.quantity, price: i.unit_price })),
          total: order.total,
          paymentMethod,
          paymentAmount: total,
        });
      }
      setCart([]);
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <main className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="text-sm text-slate-400">Đang chuyển tới đăng nhập...</div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      <header className="sticky top-0 z-30 bg-slate-900/80 backdrop-blur border-b border-white/10">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Store className="w-5 h-5 text-blue-300" />
            <div>
              <div className="text-lg font-bold">POS bán nhanh</div>
              <div className="text-xs text-slate-400">onebiz.com.vn</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                if (!supabase) return;
                await supabase.auth.signOut();
                router.replace("/login");
              }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border border-white/10 hover:bg-white/5"
            >
              <LogOut className="w-4 h-4" />
              Đăng xuất
            </button>
          </div>
        </div>
      </header>

      <main className="px-6 py-4 space-y-4">
        {error && (
          <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <select
                value={branchId}
                onChange={async (e) => {
                  setBranchId(e.target.value);
                  if (e.target.value && can("branch.switch")) await setMyBranch(e.target.value);
                }}
                disabled={!can("branch.read_all")}
                className="px-3 py-2 rounded-lg bg-slate-900/60 border border-white/10 text-xs"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="px-3 py-2 rounded-lg bg-slate-900/60 border border-white/10 text-xs"
              >
                {warehouses
                  .filter((w) => !branchId || (w.branch_id ?? null) === branchId)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
              </select>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm SKU, tên sản phẩm..."
                className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-slate-900/60 border border-white/10 text-xs"
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="px-3 py-2 rounded-lg bg-slate-900/60 border border-white/10 text-xs"
              >
                <option value="">Tất cả danh mục</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button
                disabled={!can("pos.shift.open") || busy}
                onClick={async () => {
                  if (shiftId) return;
                  const cash = Number.parseFloat(openingCash || "0");
                  if (!Number.isFinite(cash) || cash < 0) {
                    setError("Tiền đầu ca không hợp lệ.");
                    return;
                  }
                  setBusy(true);
                  try {
                    const id = await openShift({ branchId, openingCash: cash });
                    if (!id) {
                      setError("Không mở ca được (kiểm tra quyền).");
                      return;
                    }
                    setShiftId(id);
                  } finally {
                    setBusy(false);
                  }
                }}
                className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-bold hover:bg-white/10 disabled:opacity-60"
              >
                {shiftId ? "Ca đang mở" : "Mở ca"}
              </button>
              <input
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                className="w-28 px-3 py-2 rounded-lg bg-slate-900/60 border border-white/10 text-xs"
                placeholder="Tiền đầu ca"
                inputMode="numeric"
              />
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <div className="text-xs text-slate-400 mb-2">Danh sách sản phẩm</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
                {catalog === null && (
                  <div className="col-span-2 sm:col-span-3 xl:col-span-4 text-xs text-slate-400 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Đang tải sản phẩm...
                  </div>
                )}
                {(catalog ?? []).map((i) => (
                  <button
                    key={i.product_id}
                    onClick={() => addToCart(i)}
                    className="text-left p-2 rounded-lg border border-white/10 hover:bg-white/10"
                  >
                    <div className="text-[10px] text-slate-400 font-mono">{i.sku}</div>
                    <div className="text-xs font-bold mt-1 line-clamp-2">{i.name}</div>
                    <div className="text-xs text-blue-300 font-bold mt-1">{formatCurrency(i.price)}</div>
                    <div className="text-[10px] text-slate-400">SL: {i.stock}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-xl flex flex-col">
            <div className="p-3 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-slate-300" />
                <div className="text-xs font-bold">Giỏ hàng</div>
              </div>
              <button onClick={() => setCart([])} className="text-xs text-rose-300 hover:text-rose-200">
                Xóa giỏ
              </button>
            </div>

            <div className="p-3 space-y-2 flex-1 overflow-y-auto">
              {cart.length === 0 && <div className="text-xs text-slate-400">Chưa có sản phẩm.</div>}
              {cart.map((l) => (
                <div key={l.item.product_id} className="rounded-lg border border-white/10 p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-bold truncate">{l.item.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{l.item.sku}</div>
                    </div>
                    <div className="text-xs font-bold">{formatCurrency(l.item.price * l.qty)}</div>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="text-[10px] text-slate-400">{formatCurrency(l.item.price)} / sp</div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setQty(l.item.product_id, l.qty - 1)}
                        className="w-7 h-7 rounded-lg border border-white/10 hover:bg-white/10 flex items-center justify-center"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <div className="w-8 text-center text-xs font-bold">{l.qty}</div>
                      <button
                        onClick={() => setQty(l.item.product_id, l.qty + 1)}
                        className="w-7 h-7 rounded-lg border border-white/10 hover:bg-white/10 flex items-center justify-center"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-3 border-t border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-400">Tổng</div>
                <div className="text-sm font-bold text-blue-300">{formatCurrency(total)}</div>
              </div>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as any)}
                className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-white/10 text-xs"
              >
                <option value="cash">Tiền mặt</option>
                <option value="bank_transfer">Chuyển khoản</option>
                <option value="card">Thẻ</option>
                <option value="momo">MoMo</option>
                <option value="zalopay">ZaloPay</option>
                <option value="other">Khác</option>
              </select>
              <div className="flex gap-2">
                <button
                  onClick={() => handlePrint(buildReceiptFromCart(), "Tạm tính")}
                  disabled={cart.length === 0}
                  className="flex-1 py-2 rounded-lg border border-white/10 text-xs font-bold hover:bg-white/10 disabled:opacity-60"
                >
                  <Printer className="w-4 h-4 inline-block mr-1" /> Tạm tính
                </button>
                <button
                  onClick={() => void handleCheckout()}
                  disabled={cart.length === 0 || busy || !can("pos.order.create") || !can("pos.payment.record") || !shiftId}
                  className="flex-1 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-xs font-bold disabled:opacity-60"
                >
                  {busy ? "Đang xử lý..." : "Thanh toán"}
                </button>
              </div>
              {receipt && (
                <div className="mt-2 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1 text-emerald-300">
                    <CheckCircle2 className="w-4 h-4" /> {receipt.orderNumber}
                  </div>
                  <button
                    onClick={() => handlePrint(receipt, "Hóa đơn")}
                    className="flex items-center gap-1 text-blue-200"
                  >
                    <Printer className="w-4 h-4" /> In hóa đơn
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
