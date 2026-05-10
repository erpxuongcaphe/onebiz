"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type AppId = "fnb" | "retail" | "manager" | "kds";
type DeviceKind = "pos" | "tablet" | "mobile" | "kds";

interface DevicePreset {
  id: string;
  label: string;
  hint: string;
  width: number;
  height: number;
  kind: DeviceKind;
}

interface ScreenConfig {
  id: string;
  label: string;
  hint: string;
}

const DEVICES: DevicePreset[] = [
  { id: "pos-1366", label: "POS 1366 x 768", hint: "Máy POS phổ biến", width: 1366, height: 768, kind: "pos" },
  { id: "pos-1920", label: "Monitor 1920 x 1080", hint: "KDS / màn lớn", width: 1920, height: 1080, kind: "kds" },
  { id: "tablet-1280", label: "Tablet 1280 x 800", hint: "Android tablet", width: 1280, height: 800, kind: "tablet" },
  { id: "tablet-1024", label: "Tablet 1024 x 768", hint: "iPad ngang", width: 1024, height: 768, kind: "tablet" },
  { id: "mobile-s25", label: "Galaxy S25 360 x 780", hint: "6.2 inch compact", width: 360, height: 780, kind: "mobile" },
  { id: "mobile-iphone16", label: "iPhone 16 393 x 852", hint: "6.1 inch phổ biến", width: 393, height: 852, kind: "mobile" },
  { id: "mobile-iphone16pro", label: "iPhone 16 Pro 402 x 874", hint: "6.3 inch cao cấp", width: 402, height: 874, kind: "mobile" },
  { id: "mobile-pixel9pro", label: "Pixel 9 Pro XL 412 x 915", hint: "6.8 inch Android", width: 412, height: 915, kind: "mobile" },
  { id: "mobile-iphone16max", label: "iPhone 16 Pro Max 440 x 956", hint: "6.9 inch rất lớn", width: 440, height: 956, kind: "mobile" },
];

const APP_CONFIG: Record<AppId, { label: string; subtitle: string; icon: string; screens: ScreenConfig[] }> = {
  fnb: {
    label: "FnB POS",
    subtitle: "Bán tại bàn, mang đi, giao hàng, thanh toán và bếp",
    icon: "coffee",
    screens: [
      { id: "order", label: "Bán hàng", hint: "Menu, bàn, giỏ hàng" },
      { id: "tables", label: "Sơ đồ bàn", hint: "Trạng thái bàn, chuyển/gộp" },
      { id: "payment", label: "Thanh toán", hint: "Tiền mặt, thẻ, chuyển khoản" },
      { id: "handoff", label: "Giao món", hint: "Đơn sẵn sàng, runner" },
    ],
  },
  retail: {
    label: "Retail POS",
    subtitle: "Quét mã, tìm sản phẩm, giữ đơn, thu tiền nhanh",
    icon: "point_of_sale",
    screens: [
      { id: "checkout", label: "Bán hàng", hint: "Tìm hàng + giỏ" },
      { id: "barcode", label: "Quét mã", hint: "Barcode, tồn chi nhánh" },
      { id: "payment", label: "Thanh toán", hint: "Đa phương thức" },
      { id: "lookup", label: "Tra cứu", hint: "Mobile hỗ trợ kho" },
    ],
  },
  manager: {
    label: "Manager",
    subtitle: "Doanh số, tồn kho, cảnh báo, hoạt động vận hành",
    icon: "monitoring",
    screens: [
      { id: "dashboard", label: "Tổng quan", hint: "KPI trong 5 giây" },
      { id: "inventory", label: "Tồn kho", hint: "Cảnh báo sắp hết" },
      { id: "activity", label: "Hoạt động", hint: "Đơn, phiếu, audit dễ đọc" },
      { id: "analytics", label: "Phân tích", hint: "Chi nhánh, giờ bán" },
    ],
  },
  kds: {
    label: "KDS",
    subtitle: "Màn hình bếp, pha chế, expo và giao món",
    icon: "restaurant",
    screens: [
      { id: "board", label: "Bếp chính", hint: "Cột trạng thái" },
      { id: "stations", label: "Trạm bếp", hint: "Bếp, bar, pha chế" },
      { id: "expo", label: "Expo", hint: "Kiểm và giao món" },
      { id: "runner", label: "Runner", hint: "Mobile giao món" },
    ],
  },
};

const FNB_PRODUCTS = [
  { name: "Cà phê sữa", price: "32,000", tag: "Bán chạy", color: "bg-blue-50 text-blue-700" },
  { name: "Bạc xỉu", price: "35,000", tag: "Mới", color: "bg-emerald-50 text-emerald-700" },
  { name: "Trà đào", price: "39,000", tag: "Lạnh", color: "bg-amber-50 text-amber-700" },
  { name: "Matcha latte", price: "49,000", tag: "Size M", color: "bg-green-50 text-green-700" },
  { name: "Espresso", price: "29,000", tag: "Nóng", color: "bg-orange-50 text-orange-700" },
  { name: "Croissant", price: "42,000", tag: "Bánh", color: "bg-sky-50 text-sky-700" },
];

const RETAIL_PRODUCTS = [
  { code: "SP000128", name: "Cà phê hạt Arabica 500g", stock: 48, price: "129,000" },
  { code: "SP000214", name: "Máy pha mini Z3", stock: 6, price: "1,250,000" },
  { code: "SP000318", name: "Ly giữ nhiệt OneBiz", stock: 32, price: "189,000" },
  { code: "SP000419", name: "Phin inox cao cấp", stock: 14, price: "85,000" },
];

const KITCHEN_ORDERS = [
  { table: "B12", time: "08:42", status: "Chờ", items: ["2 Cà phê sữa", "1 Croissant"], tone: "warning" },
  { table: "M03", time: "08:39", status: "Đang làm", items: ["1 Trà đào ít đá", "1 Bạc xỉu"], tone: "info" },
  { table: "Giao hàng", time: "08:37", status: "Sẵn sàng", items: ["3 Matcha latte", "2 Espresso"], tone: "success" },
  { table: "A04", time: "08:31", status: "Quá lâu", items: ["1 Cappuccino", "1 Bánh mì"], tone: "danger" },
];

const LOW_STOCK = [
  { name: "Sữa tươi Dalat 1L", branch: "CN-KT", stock: "4 hộp", suggest: "Đề xuất nhập 24" },
  { name: "Cốc giấy 12oz", branch: "Kho Tổng", stock: "120 cái", suggest: "Sắp dưới min" },
  { name: "Arabica rang mộc", branch: "CN-Q1", stock: "3 kg", suggest: "Chuyển từ Kho Tổng" },
];

export default function PwaMockupPage() {
  const [activeApp, setActiveApp] = useState<AppId>("fnb");
  const [activeScreen, setActiveScreen] = useState("order");
  const [activeDeviceId, setActiveDeviceId] = useState("pos-1366");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const app = params.get("app") as AppId | null;
    const device = params.get("device");
    const screen = params.get("screen");
    if (app && app in APP_CONFIG) {
      setActiveApp(app);
      setActiveScreen(
        APP_CONFIG[app].screens.some((item) => item.id === screen)
          ? String(screen)
          : APP_CONFIG[app].screens[0].id,
      );
    }
    if (device && DEVICES.some((item) => item.id === device)) {
      setActiveDeviceId(device);
    }
  }, []);

  const activeDevice = DEVICES.find((device) => device.id === activeDeviceId) ?? DEVICES[0];
  const activeConfig = APP_CONFIG[activeApp];
  const currentScreen = activeConfig.screens.find((screen) => screen.id === activeScreen) ?? activeConfig.screens[0];

  const scale = useMemo(() => {
    const maxWidth = 920;
    const maxHeight = activeDevice.kind === "mobile" ? 640 : 620;
    return Math.min(1, maxWidth / activeDevice.width, maxHeight / activeDevice.height);
  }, [activeDevice]);

  function switchApp(nextApp: AppId) {
    setActiveApp(nextApp);
    setActiveScreen(APP_CONFIG[nextApp].screens[0].id);
    if (nextApp === "manager") setActiveDeviceId("mobile-iphone16");
    if (nextApp === "kds") setActiveDeviceId("pos-1920");
    if (nextApp === "fnb") setActiveDeviceId("pos-1366");
    if (nextApp === "retail") setActiveDeviceId("pos-1366");
  }

  return (
    <main className="min-h-screen bg-surface-container-low text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-white/95 px-4 py-3 backdrop-blur md:px-6">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-lg font-extrabold text-primary-foreground">
                O.
              </div>
              <div>
                <h1 className="font-heading text-xl font-bold leading-tight md:text-2xl">OneBiz PWA Mockup</h1>
                <p className="text-xs text-muted-foreground md:text-sm">
                  Mockup tương tác cho app nội bộ, dùng dữ liệu giả, không tác động hệ thống thật
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {(Object.keys(APP_CONFIG) as AppId[]).map((appId) => (
              <button
                key={appId}
                onClick={() => switchApp(appId)}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors",
                  activeApp === appId
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-white text-muted-foreground hover:bg-primary-fixed hover:text-primary",
                )}
              >
                <Icon name={APP_CONFIG[appId].icon} size={16} />
                {APP_CONFIG[appId].label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] gap-4 p-4 md:p-6 xl:grid-cols-[320px_1fr]">
        <aside className="space-y-4">
          <section className="rounded-xl border border-border bg-white p-3 shadow-sm">
            <div className="mb-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Màn hình</div>
              <div className="mt-1 text-sm font-semibold">{activeConfig.subtitle}</div>
            </div>
            <div className="space-y-2">
              {activeConfig.screens.map((screen) => (
                <button
                  key={screen.id}
                  onClick={() => setActiveScreen(screen.id)}
                  className={cn(
                    "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                    activeScreen === screen.id
                      ? "border-primary bg-primary-fixed text-primary"
                      : "border-border bg-white hover:bg-muted",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{screen.label}</span>
                    {activeScreen === screen.id && <Icon name="check" size={16} />}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{screen.hint}</div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-white p-3 shadow-sm">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Thiết bị</div>
            <div className="grid gap-2">
              {DEVICES.map((device) => (
                <button
                  key={device.id}
                  onClick={() => setActiveDeviceId(device.id)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left transition-colors",
                    activeDeviceId === device.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-white hover:bg-muted",
                  )}
                >
                  <div className="text-sm font-semibold">{device.label}</div>
                  <div className={cn("text-xs", activeDeviceId === device.id ? "text-primary-foreground/75" : "text-muted-foreground")}>
                    {device.hint}
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-white p-3 shadow-sm">
            <div className="flex items-start gap-2">
              <Icon name="verified" size={18} className="mt-0.5 text-status-success" />
              <div>
                <div className="text-sm font-semibold">Nguyên tắc an toàn</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Route này chỉ là UI mockup. Không gọi API bán hàng, không ghi Supabase, không thay layout web thật.
                </p>
              </div>
            </div>
          </section>
        </aside>

        <section className="min-w-0 space-y-4">
          <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <Icon name={activeConfig.icon} size={18} />
                  {activeConfig.label}
                  <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{activeDevice.label}</span>
                </div>
                <h2 className="mt-1 font-heading text-2xl font-bold">{currentScreen.label}</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-md border border-border px-2 py-1">{activeDevice.width} x {activeDevice.height}</span>
                <span className="rounded-md border border-border px-2 py-1">Scale {Math.round(scale * 100)}%</span>
                <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">Mock data</span>
              </div>
            </div>

            <div className="overflow-auto rounded-2xl border border-outline-variant bg-[#edf3ff] p-3 md:p-5">
              <div
                className="mx-auto"
                style={{
                  width: activeDevice.width * scale,
                  height: activeDevice.height * scale,
                }}
              >
                <div
                  className="overflow-hidden rounded-[26px] border border-slate-300 bg-background shadow-2xl"
                  style={{
                    width: activeDevice.width,
                    height: activeDevice.height,
                    transform: `scale(${scale})`,
                    transformOrigin: "top left",
                  }}
                >
                  <AppPreview appId={activeApp} screenId={currentScreen.id} device={activeDevice} />
                </div>
              </div>
            </div>
          </div>

          <ScreenMap activeApp={activeApp} />
        </section>
      </div>
    </main>
  );
}

function AppPreview({ appId, screenId, device }: { appId: AppId; screenId: string; device: DevicePreset }) {
  if (appId === "fnb") return <FnbPreview screenId={screenId} device={device} />;
  if (appId === "retail") return <RetailPreview screenId={screenId} device={device} />;
  if (appId === "manager") return <ManagerPreview screenId={screenId} device={device} />;
  return <KdsPreview screenId={screenId} device={device} />;
}

function ScreenMap({ activeApp }: { activeApp: AppId }) {
  const config = APP_CONFIG[activeApp];
  return (
    <section className="rounded-xl border border-border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-heading text-base font-bold">Bộ trang cần code thật sau khi duyệt</h3>
          <p className="text-sm text-muted-foreground">Giữ đúng domain/route riêng để không ảnh hưởng web chung.</p>
        </div>
        <Icon name="route" size={22} className="text-primary" />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {config.screens.map((screen, index) => (
          <div key={screen.id} className="rounded-lg border border-border bg-surface-container-lowest p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary-fixed text-xs font-bold text-primary">
                {index + 1}
              </span>
              <span className="text-xs text-muted-foreground">/{screen.id}</span>
            </div>
            <div className="text-sm font-semibold">{screen.label}</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">{screen.hint}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TopBar({
  title,
  mode,
  icon,
  compact,
}: {
  title: string;
  mode: string;
  icon: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex items-center justify-between border-b border-border bg-white", compact ? "h-14 px-3" : "h-16 px-5")}>
      <div className="flex min-w-0 items-center gap-3">
        <div className={cn("flex shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground", compact ? "size-9" : "size-11")}>
          <span className="font-heading text-lg font-extrabold">O.</span>
        </div>
        <div className="min-w-0">
          <div className={cn("truncate font-heading font-bold", compact ? "text-base" : "text-xl")}>ONEBIZ.</div>
          <div className="truncate text-xs text-muted-foreground">{title}</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {!compact && (
          <div className="flex h-9 items-center gap-2 rounded-lg border border-border bg-primary-fixed px-3 text-sm font-semibold text-primary">
            <Icon name="warehouse" size={16} />
            Kho Tổng
          </div>
        )}
        <div className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground">
          <Icon name={icon} size={16} />
          {mode}
        </div>
        {!compact && (
          <div className="flex items-center gap-2 rounded-full border border-border px-2 py-1">
            <span className="size-2 rounded-full bg-status-success" />
            <span className="text-xs font-medium">Online</span>
          </div>
        )}
      </div>
    </div>
  );
}

function FnbPreview({ screenId, device }: { screenId: string; device: DevicePreset }) {
  const compact = device.kind === "mobile";
  return (
    <div className="flex h-full flex-col bg-background">
      <TopBar title="Quầy cà phê" mode="POS FnB" icon="coffee" compact={compact} />
      {screenId === "order" && <FnbOrder compact={compact} />}
      {screenId === "tables" && <FnbTables compact={compact} />}
      {screenId === "payment" && <FnbPayment compact={compact} />}
      {screenId === "handoff" && <FnbHandoff compact={compact} />}
    </div>
  );
}

function FnbOrder({ compact }: { compact: boolean }) {
  if (compact) {
    return (
      <PosMobileShell active="Món" variant="fnb">
        <SearchBox placeholder="Tìm món, bàn..." />
        <Segment options={["Tại bàn", "Mang đi", "Giao hàng"]} active="Tại bàn" />
        <div className="grid grid-cols-2 gap-2">
          {FNB_PRODUCTS.slice(0, 4).map((item) => (
            <ProductTile key={item.name} item={item} compact />
          ))}
        </div>
        <MobileTotalCard total="178,000" primary="Thanh toán" secondary="Gửi bếp" />
      </PosMobileShell>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[190px_1fr_360px] gap-4 p-4">
      <SideNav
        title="Danh mục"
        items={["Tất cả", "Cà phê", "Trà", "Đá xay", "Bánh", "Combo"]}
        active="Cà phê"
      />
      <section className="flex min-w-0 flex-col gap-3">
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <SearchBox placeholder="Tìm món, mã bàn, ghi chú..." />
          <Segment options={["Tại bàn", "Mang đi", "Giao hàng"]} active="Tại bàn" />
        </div>
        <div className="grid flex-1 grid-cols-3 gap-3 overflow-hidden">
          {FNB_PRODUCTS.map((item) => (
            <ProductTile key={item.name} item={item} />
          ))}
        </div>
        <div className="grid grid-cols-5 gap-2">
          {["A01", "A04", "B12", "Sân 2", "Mang đi"].map((table) => (
            <button key={table} className="h-12 rounded-lg border border-border bg-white text-sm font-semibold hover:bg-primary-fixed">
              {table}
            </button>
          ))}
        </div>
      </section>
      <CartPanel title="Bàn B12" total="178,000" primary="Thanh toán" />
    </div>
  );
}

function FnbTables({ compact }: { compact: boolean }) {
  const tables = ["A01", "A02", "A03", "A04", "B10", "B11", "B12", "B13", "Sân 1", "Sân 2", "VIP 1", "VIP 2"];
  return (
    <div className={cn("grid min-h-0 flex-1 gap-4 p-4", compact ? "grid-cols-1 overflow-auto" : "grid-cols-[1fr_360px]")}>
      <section className="rounded-xl border border-border bg-white p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-heading text-lg font-bold">Sơ đồ bàn</h3>
            <p className="text-sm text-muted-foreground">Tầng 1 · 12 bàn</p>
          </div>
          <Segment options={["Tất cả", "Đang dùng", "Trống"]} active="Đang dùng" />
        </div>
        <div className={cn("grid gap-3", compact ? "grid-cols-2" : "grid-cols-4")}>
          {tables.map((table, index) => {
            const busy = [1, 3, 6, 9].includes(index);
            return (
              <button
                key={table}
                className={cn(
                  "min-h-24 rounded-xl border p-3 text-left transition-colors",
                  busy ? "border-primary bg-primary-fixed" : "border-border bg-surface-container-lowest",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-heading text-lg font-bold">{table}</span>
                  <Icon name={busy ? "local_cafe" : "chair"} size={20} className={busy ? "text-primary" : "text-muted-foreground"} />
                </div>
                <div className="mt-4 text-xs text-muted-foreground">{busy ? "2 món · 18 phút" : "Trống"}</div>
              </button>
            );
          })}
        </div>
      </section>
      <CartPanel title="Bàn A04" total="124,000" primary="Gửi bếp" />
    </div>
  );
}

function FnbPayment({ compact }: { compact: boolean }) {
  return (
    <div className={cn("grid min-h-0 flex-1 gap-4 p-4", compact ? "grid-cols-1 overflow-auto" : "grid-cols-[1fr_360px_320px]")}>
      <PaymentMethods />
      <ReceiptPanel />
      <NumberPad total="178,000" />
    </div>
  );
}

function FnbHandoff({ compact }: { compact: boolean }) {
  return (
    <div className={cn("grid min-h-0 flex-1 gap-4 p-4", compact ? "grid-cols-1 overflow-auto" : "grid-cols-[1fr_1fr_1fr]")}>
      {["Chờ bếp", "Đang làm", "Sẵn sàng"].map((column) => (
        <section key={column} className="rounded-xl border border-border bg-white p-3">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-heading text-base font-bold">{column}</h3>
            <span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold">3</span>
          </div>
          <div className="space-y-2">
            {KITCHEN_ORDERS.slice(0, 3).map((order) => (
              <KitchenCard key={`${column}-${order.table}`} order={order} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function RetailPreview({ screenId, device }: { screenId: string; device: DevicePreset }) {
  const compact = device.kind === "mobile";
  return (
    <div className="flex h-full flex-col bg-background">
      <TopBar title="Bán lẻ tại quầy" mode="POS Retail" icon="point_of_sale" compact={compact} />
      {screenId === "checkout" && <RetailCheckout compact={compact} />}
      {screenId === "barcode" && <RetailBarcode compact={compact} />}
      {screenId === "payment" && <FnbPayment compact={compact} />}
      {screenId === "lookup" && <RetailLookup compact={compact} />}
    </div>
  );
}

function RetailCheckout({ compact }: { compact: boolean }) {
  if (compact) {
    return (
      <PosMobileShell active="Quét" variant="retail">
        <SearchBox placeholder="Quét mã hoặc tìm sản phẩm" />
        <div className="space-y-2">
          {RETAIL_PRODUCTS.slice(0, 3).map((item) => (
            <InventoryRow key={item.code} item={item} />
          ))}
        </div>
        <MobileTotalCard total="1,568,000" primary="Thanh toán" secondary="Giữ đơn" />
      </PosMobileShell>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1fr_390px] gap-4 p-4">
      <section className="flex min-w-0 flex-col gap-3">
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <SearchBox placeholder="Quét barcode, tìm sản phẩm, khách hàng..." />
          <Button size="touch" className="h-11">
            <Icon name="barcode_scanner" size={18} className="mr-2" />
            Quét mã
          </Button>
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-white">
          <div className="grid grid-cols-[120px_1fr_100px_120px] border-b border-border bg-muted px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Mã hàng</span>
            <span>Sản phẩm</span>
            <span>Tồn</span>
            <span className="text-right">Giá bán</span>
          </div>
          {RETAIL_PRODUCTS.map((item) => (
            <div key={item.code} className="grid grid-cols-[120px_1fr_100px_120px] items-center border-b border-border px-3 py-3 last:border-b-0">
              <span className="text-sm font-medium text-muted-foreground">{item.code}</span>
              <span className="text-sm font-semibold">{item.name}</span>
              <span className={cn("text-sm font-semibold", item.stock < 10 ? "text-status-warning" : "text-status-success")}>{item.stock}</span>
              <span className="text-right text-sm font-bold">{item.price}</span>
            </div>
          ))}
        </div>
      </section>
      <CartPanel title="Đơn bán lẻ" total="1,568,000" primary="Thanh toán" secondary="Giữ đơn" />
    </div>
  );
}

function RetailBarcode({ compact }: { compact: boolean }) {
  return (
    <div className={cn("grid min-h-0 flex-1 gap-4 p-4", compact ? "grid-cols-1 overflow-auto" : "grid-cols-[420px_1fr]")}>
      <section className="rounded-xl border border-border bg-white p-4">
        <div className="flex h-44 flex-col items-center justify-center rounded-xl border-2 border-dashed border-primary/30 bg-primary-fixed">
          <Icon name="barcode_scanner" size={44} className="text-primary" />
          <div className="mt-3 font-heading text-lg font-bold">Sẵn sàng quét mã</div>
          <div className="text-sm text-muted-foreground">Focus tự động vào ô barcode</div>
        </div>
        <div className="mt-4">
          <SearchBox placeholder="8938505970012" />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {["-1", "+1", "+5", "Giá", "CK", "Xóa"].map((key) => (
            <button key={key} className="h-12 rounded-lg border border-border bg-white text-sm font-semibold hover:bg-muted">
              {key}
            </button>
          ))}
        </div>
      </section>
      <section className="rounded-xl border border-border bg-white p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-heading text-xl font-bold">Máy pha mini Z3</h3>
            <p className="text-sm text-muted-foreground">SP000214 · Thiết bị</p>
          </div>
          <span className="rounded-lg bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-700">Tồn thấp</span>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {["Kho Tổng 6", "CN-Q1 2", "CN-KT 0"].map((branch) => (
            <div key={branch} className="rounded-lg border border-border bg-surface-container-lowest p-3">
              <div className="text-sm font-semibold">{branch}</div>
              <div className="mt-2 h-2 rounded-full bg-muted">
                <div className="h-2 w-2/5 rounded-full bg-primary" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function RetailLookup({ compact }: { compact: boolean }) {
  return (
    <PosMobileShell active="Hàng" variant="retail" wide={!compact}>
      <SearchBox placeholder="Tìm sản phẩm, SKU, barcode..." />
      <div className={cn("grid gap-3", compact ? "grid-cols-1" : "grid-cols-2")}>
        {RETAIL_PRODUCTS.map((item) => (
          <InventoryRow key={item.code} item={item} />
        ))}
      </div>
      <section className="rounded-xl border border-border bg-white p-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Icon name="sync_alt" size={18} className="text-primary" />
          Đề xuất điều chuyển
        </div>
        <p className="mt-2 text-sm text-muted-foreground">Chuyển 4 Máy pha mini Z3 từ Kho Tổng sang CN-Q1 trước 15:00.</p>
      </section>
    </PosMobileShell>
  );
}

function ManagerPreview({ screenId, device }: { screenId: string; device: DevicePreset }) {
  const compact = device.kind === "mobile";
  return (
    <div className="h-full bg-background">
      {screenId === "dashboard" && <ManagerDashboard compact={compact} />}
      {screenId === "inventory" && <ManagerInventory compact={compact} />}
      {screenId === "activity" && <ManagerActivity compact={compact} />}
      {screenId === "analytics" && <ManagerAnalytics compact={compact} />}
    </div>
  );
}

function ManagerHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border bg-white px-4 py-3">
      <div>
        <h2 className="font-heading text-xl font-bold">{title}</h2>
        <div className="text-xs text-muted-foreground">09/05/2026 · Kho Tổng</div>
      </div>
      <div className="flex size-10 items-center justify-center rounded-full bg-primary-fixed font-bold text-primary">A</div>
    </div>
  );
}

function ManagerDashboard({ compact }: { compact: boolean }) {
  return (
    <div className="flex h-full flex-col">
      <ManagerHeader title="Tổng quan" />
      <div className={cn("flex-1 overflow-auto p-4", compact ? "space-y-3" : "grid grid-cols-[1fr_1fr] gap-4")}>
        <div className={cn("grid gap-3", compact ? "grid-cols-2" : "grid-cols-4 col-span-2")}>
          <MetricCard label="Doanh thu" value="12,450,000" delta="+8.4%" icon="trending_up" />
          <MetricCard label="Đơn hàng" value="126" delta="+12" icon="shopping_cart" />
          <MetricCard label="Lợi nhuận" value="3,240,000" delta="+5.1%" icon="payments" />
          <MetricCard label="Hàng sắp hết" value="8" delta="Cần xử lý" icon="warning" tone="warning" />
        </div>
        <ChartPanel title="Doanh thu theo giờ" />
        <section className="rounded-xl border border-border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-heading text-base font-bold">Hoạt động gần đây</h3>
            <span className="text-xs font-semibold text-primary">Xem tất cả</span>
          </div>
          <ActivityList />
        </section>
      </div>
      {compact && <BottomNav active="Tổng quan" />}
    </div>
  );
}

function ManagerInventory({ compact }: { compact: boolean }) {
  return (
    <div className="flex h-full flex-col">
      <ManagerHeader title="Tồn kho cảnh báo" />
      <div className={cn("flex-1 overflow-auto p-4", compact ? "space-y-3" : "grid grid-cols-[1fr_360px] gap-4")}>
        <section className="rounded-xl border border-border bg-white p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {["Sắp hết", "Âm kho", "Hết hạn", "Cần nhập"].map((chip, index) => (
              <span key={chip} className={cn("rounded-full px-3 py-1 text-xs font-semibold", index === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                {chip}
              </span>
            ))}
          </div>
          <div className="space-y-3">
            {LOW_STOCK.map((item) => (
              <div key={item.name} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{item.name}</div>
                    <div className="text-sm text-muted-foreground">{item.branch}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-heading text-lg font-bold text-status-warning">{item.stock}</div>
                    <div className="text-xs text-muted-foreground">{item.suggest}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
        {!compact && <ChartPanel title="Tồn kho theo nhóm" />}
      </div>
      {compact && <BottomNav active="Kho" />}
    </div>
  );
}

function ManagerActivity({ compact }: { compact: boolean }) {
  return (
    <div className="flex h-full flex-col">
      <ManagerHeader title="Hoạt động" />
      <div className={cn("flex-1 overflow-auto p-4", compact ? "space-y-3" : "grid grid-cols-[1fr_1fr] gap-4")}>
        <section className="rounded-xl border border-border bg-white p-4">
          <h3 className="mb-3 font-heading text-base font-bold">Đơn và phiếu mới</h3>
          <ActivityList />
        </section>
        <section className="rounded-xl border border-border bg-white p-4">
          <h3 className="mb-3 font-heading text-base font-bold">Chờ duyệt</h3>
          {["NK000045 · Nhập hàng", "CK000018 · Chuyển kho", "HD000128 · Giảm giá"].map((row) => (
            <div key={row} className="mb-2 flex items-center justify-between rounded-lg border border-border p-3 last:mb-0">
              <span className="text-sm font-semibold">{row}</span>
              <Button size="sm" variant="outline">Duyệt</Button>
            </div>
          ))}
        </section>
      </div>
      {compact && <BottomNav active="Thêm" />}
    </div>
  );
}

function ManagerAnalytics({ compact }: { compact: boolean }) {
  return (
    <div className="flex h-full flex-col">
      <ManagerHeader title="Phân tích" />
      <div className={cn("flex-1 overflow-auto p-4", compact ? "space-y-3" : "grid grid-cols-[1.2fr_0.8fr] gap-4")}>
        <ChartPanel title="So sánh chi nhánh" tall />
        <section className="rounded-xl border border-border bg-white p-4">
          <h3 className="mb-3 font-heading text-base font-bold">Top sản phẩm</h3>
          {FNB_PRODUCTS.slice(0, 5).map((item, index) => (
            <div key={item.name} className="flex items-center gap-3 border-b border-border py-2 last:border-b-0">
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary-fixed text-xs font-bold text-primary">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{item.name}</div>
                <div className="text-xs text-muted-foreground">{item.price} · +{index + 4}%</div>
              </div>
            </div>
          ))}
        </section>
      </div>
      {compact && <BottomNav active="Báo cáo" />}
    </div>
  );
}

function KdsPreview({ screenId, device }: { screenId: string; device: DevicePreset }) {
  const compact = device.kind === "mobile";
  return (
    <div className="flex h-full flex-col bg-background">
      <TopBar title="Màn hình bếp" mode="KDS" icon="restaurant" compact={compact} />
      {screenId === "board" && <KdsBoard compact={compact} />}
      {screenId === "stations" && <KdsStations compact={compact} />}
      {screenId === "expo" && <KdsExpo compact={compact} />}
      {screenId === "runner" && <KdsRunner compact={compact} />}
    </div>
  );
}

function KdsBoard({ compact }: { compact: boolean }) {
  return (
    <div className={cn("grid min-h-0 flex-1 gap-4 p-4", compact ? "grid-cols-1 overflow-auto" : "grid-cols-3")}>
      {["Chờ", "Đang làm", "Sẵn sàng"].map((column) => (
        <section key={column} className="rounded-xl border border-border bg-white p-3">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-heading text-xl font-bold">{column}</h3>
            <span className="rounded-full bg-muted px-3 py-1 text-sm font-semibold">4 đơn</span>
          </div>
          <div className="space-y-3">
            {KITCHEN_ORDERS.map((order) => (
              <KitchenCard key={`${column}-${order.table}`} order={order} large />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function KdsStations({ compact }: { compact: boolean }) {
  return (
    <div className={cn("grid min-h-0 flex-1 gap-4 p-4", compact ? "grid-cols-1 overflow-auto" : "grid-cols-[280px_1fr]")}>
      <SideNav title="Trạm" items={["Tất cả", "Bếp chính", "Pha chế", "Bar", "Giao hàng"]} active="Pha chế" />
      <section className="grid gap-4 md:grid-cols-2">
        {["Bếp chính", "Pha chế", "Bar", "Expo"].map((station, index) => (
          <div key={station} className="rounded-xl border border-border bg-white p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold">{station}</h3>
              <span className={cn("rounded-full px-3 py-1 text-sm font-bold", index === 1 ? "bg-amber-50 text-amber-700" : "bg-primary-fixed text-primary")}>
                {index + 3} đơn
              </span>
            </div>
            <div className="mt-4 space-y-2">
              {KITCHEN_ORDERS.slice(0, 2).map((order) => (
                <KitchenCard key={`${station}-${order.table}`} order={order} />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function KdsExpo({ compact }: { compact: boolean }) {
  return (
    <div className={cn("grid min-h-0 flex-1 gap-4 p-4", compact ? "grid-cols-1 overflow-auto" : "grid-cols-[1fr_380px]")}>
      <section className="rounded-xl border border-border bg-white p-4">
        <h3 className="mb-3 font-heading text-xl font-bold">Đơn sẵn sàng giao</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {KITCHEN_ORDERS.map((order) => (
            <KitchenCard key={order.table} order={{ ...order, status: "Sẵn sàng", tone: "success" }} large />
          ))}
        </div>
      </section>
      <section className="rounded-xl border border-border bg-white p-4">
        <h3 className="mb-3 font-heading text-lg font-bold">Checklist expo</h3>
        {["Đủ món", "Đúng bàn", "Đúng ghi chú", "Đã in phiếu"].map((item) => (
          <label key={item} className="mb-3 flex items-center gap-3 rounded-lg border border-border p-3 text-sm font-semibold last:mb-0">
            <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Icon name="check" size={16} />
            </span>
            {item}
          </label>
        ))}
      </section>
    </div>
  );
}

function KdsRunner({ compact }: { compact: boolean }) {
  return (
    <KdsMobileShell active="Giao" wide={!compact}>
      <div className={cn("grid gap-3", compact ? "grid-cols-1" : "grid-cols-2")}>
        {KITCHEN_ORDERS.map((order) => (
          <KitchenCard key={order.table} order={{ ...order, status: "Sẵn sàng", tone: "success" }} large />
        ))}
      </div>
    </KdsMobileShell>
  );
}

function SearchBox({ placeholder }: { placeholder: string }) {
  return (
    <div className="flex h-11 min-w-0 items-center gap-2 rounded-xl border border-border bg-white px-3 shadow-sm">
      <Icon name="search" size={18} className="text-muted-foreground" />
      <span className="truncate text-sm text-muted-foreground">{placeholder}</span>
      <span className="ml-auto rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">Ctrl K</span>
    </div>
  );
}

function Segment({ options, active }: { options: string[]; active: string }) {
  return (
    <div className="flex h-11 items-center rounded-xl border border-border bg-white p-1 shadow-sm">
      {options.map((option) => (
        <button
          key={option}
          className={cn(
            "h-9 rounded-lg px-3 text-sm font-semibold transition-colors",
            option === active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function SideNav({ title, items, active }: { title: string; items: string[]; active: string }) {
  return (
    <section className="rounded-xl border border-border bg-white p-3">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="space-y-1">
        {items.map((item) => (
          <button
            key={item}
            className={cn(
              "flex h-10 w-full items-center justify-between rounded-lg px-3 text-sm font-semibold",
              item === active ? "bg-primary-fixed text-primary" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {item}
            {item === active && <Icon name="chevron_right" size={16} />}
          </button>
        ))}
      </div>
    </section>
  );
}

function ProductTile({ item, compact }: { item: (typeof FNB_PRODUCTS)[number]; compact?: boolean }) {
  return (
    <button className={cn("rounded-xl border border-border bg-white p-3 text-left shadow-sm transition-colors hover:bg-primary-fixed", compact ? "min-h-28" : "min-h-40")}>
      <div className="flex items-start justify-between gap-2">
        <span className={cn("rounded-md px-2 py-1 text-xs font-semibold", item.color)}>{item.tag}</span>
        <Icon name="add_circle" size={22} className="text-primary" />
      </div>
      <div className={cn("mt-5 font-heading font-bold", compact ? "text-base" : "text-lg")}>{item.name}</div>
      <div className="mt-1 text-sm font-semibold text-primary">{item.price}</div>
    </button>
  );
}

function CartPanel({ title, total, primary, secondary }: { title: string; total: string; primary: string; secondary?: string }) {
  return (
    <aside className="flex min-h-0 flex-col rounded-xl border border-border bg-white shadow-sm">
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-heading text-lg font-bold">{title}</h3>
            <p className="text-sm text-muted-foreground">3 món · Khách lẻ</p>
          </div>
          <span className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">Đã gửi bếp</span>
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-hidden p-3">
        {["Cà phê sữa", "Bạc xỉu", "Croissant"].map((item, index) => (
          <div key={item} className="rounded-lg border border-border bg-surface-container-lowest p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">{item}</div>
                <div className="text-xs text-muted-foreground">{index === 2 ? "Ít ngọt" : "Size M"}</div>
              </div>
              <div className="text-right text-sm font-bold">{index === 2 ? "42,000" : "68,000"}</div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <div className="inline-flex items-center rounded-lg border border-border">
                <button className="size-7 text-muted-foreground">-</button>
                <span className="w-8 text-center text-sm font-semibold">{index + 1}</span>
                <button className="size-7 text-primary">+</button>
              </div>
              <span className="text-xs text-primary">Ghi chú</span>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-border p-4">
        <div className="mb-3 space-y-1 text-sm">
          <div className="flex justify-between text-muted-foreground"><span>Tạm tính</span><span>{total}</span></div>
          <div className="flex justify-between text-muted-foreground"><span>Giảm giá</span><span>0</span></div>
          <div className="flex justify-between font-heading text-xl font-bold"><span>Tổng</span><span>{total}</span></div>
        </div>
        <div className={cn("grid gap-2", secondary ? "grid-cols-[0.8fr_1.2fr]" : "grid-cols-1")}>
          {secondary && <Button variant="outline" size="touch">{secondary}</Button>}
          <Button size="touch">{primary}</Button>
        </div>
      </div>
    </aside>
  );
}

function PaymentMethods() {
  return (
    <section className="rounded-xl border border-border bg-white p-4">
      <h3 className="mb-3 font-heading text-lg font-bold">Phương thức thanh toán</h3>
      <div className="grid grid-cols-2 gap-3">
        {[
          ["Tiền mặt", "payments"],
          ["Chuyển khoản", "account_balance"],
          ["Thẻ", "credit_card"],
          ["Ví điện tử", "qr_code_2"],
        ].map(([label, icon], index) => (
          <button
            key={label}
            className={cn(
              "min-h-24 rounded-xl border p-4 text-left",
              index === 0 ? "border-primary bg-primary-fixed text-primary" : "border-border bg-white hover:bg-muted",
            )}
          >
            <Icon name={icon} size={24} />
            <div className="mt-3 font-semibold">{label}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

function ReceiptPanel() {
  return (
    <section className="rounded-xl border border-border bg-white p-4">
      <h3 className="mb-3 font-heading text-lg font-bold">Tóm tắt hóa đơn</h3>
      <div className="space-y-3">
        {["Cà phê sữa x2", "Bạc xỉu x1", "Croissant x1"].map((item) => (
          <div key={item} className="flex justify-between border-b border-border pb-2 text-sm last:border-b-0">
            <span>{item}</span>
            <span className="font-semibold">68,000</span>
          </div>
        ))}
      </div>
      <div className="mt-5 rounded-xl bg-primary-fixed p-4">
        <div className="text-sm text-muted-foreground">Cần thu</div>
        <div className="font-heading text-3xl font-extrabold text-primary">178,000</div>
      </div>
    </section>
  );
}

function NumberPad({ total }: { total: string }) {
  return (
    <section className="rounded-xl border border-border bg-white p-4">
      <div className="mb-4 rounded-xl border border-border p-3 text-right">
        <div className="text-xs text-muted-foreground">Khách đưa</div>
        <div className="font-heading text-2xl font-bold">{total}</div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "000", "0", "⌫"].map((key) => (
          <button key={key} className="h-14 rounded-lg border border-border bg-surface-container-lowest text-lg font-bold hover:bg-muted">
            {key}
          </button>
        ))}
      </div>
      <Button size="touch" className="mt-4 w-full">Xác nhận thu tiền</Button>
    </section>
  );
}

function KitchenCard({ order, large }: { order: (typeof KITCHEN_ORDERS)[number]; large?: boolean }) {
  const toneClass = {
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    info: "border-blue-200 bg-blue-50 text-blue-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    danger: "border-red-200 bg-red-50 text-red-700",
  }[order.tone];

  return (
    <article className="rounded-xl border border-border bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={cn("font-heading font-bold", large ? "text-2xl" : "text-lg")}>{order.table}</div>
          <div className="text-xs text-muted-foreground">{order.time} · 12 phút</div>
        </div>
        <span className={cn("rounded-lg border px-2 py-1 text-xs font-bold", toneClass)}>{order.status}</span>
      </div>
      <div className="mt-3 space-y-1">
        {order.items.map((item) => (
          <div key={item} className={cn("font-semibold", large ? "text-base" : "text-sm")}>{item}</div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm">Bắt đầu</Button>
        <Button size="sm">Xong</Button>
      </div>
    </article>
  );
}

function MetricCard({
  label,
  value,
  delta,
  icon,
  tone = "primary",
}: {
  label: string;
  value: string;
  delta: string;
  icon: string;
  tone?: "primary" | "warning";
}) {
  return (
    <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={cn("flex size-9 items-center justify-center rounded-lg", tone === "warning" ? "bg-amber-50 text-amber-700" : "bg-primary-fixed text-primary")}>
          <Icon name={icon} size={18} />
        </div>
      </div>
      <div className="mt-4 font-heading text-2xl font-extrabold">{value}</div>
      <div className={cn("mt-1 text-sm font-semibold", tone === "warning" ? "text-amber-700" : "text-status-success")}>{delta}</div>
    </div>
  );
}

function ChartPanel({ title, tall }: { title: string; tall?: boolean }) {
  const bars = [28, 42, 36, 58, 46, 72, 64, 88, 70, 92, 78, 84];
  return (
    <section className={cn("rounded-xl border border-border bg-white p-4", tall && "min-h-[420px]")}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-heading text-base font-bold">{title}</h3>
        <Segment options={["Ngày", "Tuần", "Tháng"]} active="Ngày" />
      </div>
      <div className="flex h-56 items-end gap-2 border-b border-l border-dashed border-border px-3">
        {bars.map((height, index) => (
          <div key={index} className="flex flex-1 items-end">
            <div className="w-full rounded-t-md bg-primary" style={{ height: `${height}%`, opacity: 0.35 + index / 24 }} />
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-xs text-muted-foreground">
        <span>08:00</span>
        <span>11:00</span>
        <span>14:00</span>
        <span className="text-right">18:00</span>
      </div>
    </section>
  );
}

function ActivityList() {
  const rows = [
    ["HD000128", "Hoàn thành", "1,245,000"],
    ["NK000045", "Nhập hàng", "8,450,000"],
    ["CK000018", "Chuyển kho", "24 sản phẩm"],
    ["PT000072", "Thu tiền", "560,000"],
  ];
  return (
    <div className="space-y-2">
      {rows.map(([code, status, amount]) => (
        <div key={code} className="flex items-center gap-3 rounded-lg border border-border p-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary-fixed text-primary">
            <Icon name="description" size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{code}</div>
            <div className="text-xs text-muted-foreground">{status} · 09/05/2026</div>
          </div>
          <div className="text-right text-sm font-bold">{amount}</div>
        </div>
      ))}
    </div>
  );
}

function InventoryRow({ item }: { item: (typeof RETAIL_PRODUCTS)[number] }) {
  return (
    <div className="rounded-xl border border-border bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{item.name}</div>
          <div className="mt-1 text-xs text-muted-foreground">{item.code}</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-bold">{item.price}</div>
          <div className={cn("text-xs font-semibold", item.stock < 10 ? "text-status-warning" : "text-status-success")}>Tồn {item.stock}</div>
        </div>
      </div>
    </div>
  );
}

function MobileShell({ children, title, active, wide }: { children: React.ReactNode; title: string; active: string; wide?: boolean }) {
  return (
    <div className="flex h-full flex-col bg-background">
      <ManagerHeader title={title} />
      <div className={cn("flex-1 overflow-auto p-3", wide ? "grid grid-cols-2 gap-3" : "space-y-3")}>{children}</div>
      <BottomNav active={active} />
    </div>
  );
}

function PosMobileShell({
  children,
  active,
  variant,
  wide,
}: {
  children: React.ReactNode;
  active: string;
  variant: "fnb" | "retail";
  wide?: boolean;
}) {
  const title = variant === "fnb" ? "POS FnB" : "POS Retail";
  const subtitle = variant === "fnb" ? "Bàn B12 · Tại bàn" : "Quét mã · Khách lẻ";
  const items =
    variant === "fnb"
      ? [
          ["Món", "local_cafe"],
          ["Bàn", "table_restaurant"],
          ["Giỏ", "shopping_cart"],
          ["Thu tiền", "payments"],
          ["Thêm", "more_horiz"],
        ]
      : [
          ["Quét", "barcode_scanner"],
          ["Hàng", "inventory_2"],
          ["Giỏ", "shopping_cart"],
          ["Thu tiền", "payments"],
          ["Thêm", "more_horiz"],
        ];

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b border-border bg-white px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-heading text-lg font-bold">{title}</h2>
            <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">Online</span>
            <span className="flex size-9 items-center justify-center rounded-full bg-primary-fixed font-bold text-primary">A</span>
          </div>
        </div>
      </div>
      <div className={cn("flex-1 overflow-auto p-3", wide ? "grid grid-cols-2 gap-3" : "space-y-3")}>{children}</div>
      <RoleBottomNav active={active} items={items} />
    </div>
  );
}

function KdsMobileShell({
  children,
  active,
  wide,
}: {
  children: React.ReactNode;
  active: string;
  wide?: boolean;
}) {
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b border-border bg-white px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg font-bold">KDS Runner</h2>
            <div className="text-xs text-muted-foreground">Sẵn sàng giao · Kho Tổng</div>
          </div>
          <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">Online</span>
        </div>
      </div>
      <div className={cn("flex-1 overflow-auto p-3", wide ? "grid grid-cols-2 gap-3" : "space-y-3")}>{children}</div>
      <RoleBottomNav
        active={active}
        items={[
          ["Chờ", "pending_actions"],
          ["Giao", "room_service"],
          ["Xong", "task_alt"],
          ["Âm thanh", "volume_up"],
        ]}
      />
    </div>
  );
}

function MobileTotalCard({ total, primary, secondary }: { total: string; primary: string; secondary: string }) {
  return (
    <section className="rounded-xl border border-border bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground">Tổng thanh toán</div>
          <div className="font-heading text-2xl font-extrabold">{total}</div>
        </div>
        <span className="rounded-lg bg-primary-fixed px-2 py-1 text-xs font-semibold text-primary">3 món</span>
      </div>
      <div className="grid grid-cols-[0.8fr_1.2fr] gap-2">
        <Button variant="outline" size="touch">{secondary}</Button>
        <Button size="touch">{primary}</Button>
      </div>
    </section>
  );
}

function RoleBottomNav({ active, items }: { active: string; items: string[][] }) {
  return (
    <nav className="grid border-t border-border bg-white" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map(([label, icon]) => (
        <button key={label} className={cn("flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold", active === label ? "text-primary" : "text-muted-foreground")}>
          <Icon name={icon} size={20} fill={active === label} />
          <span className="max-w-full truncate px-1">{label}</span>
        </button>
      ))}
    </nav>
  );
}

function BottomNav({ active }: { active: string }) {
  const items = [
    ["Tổng quan", "dashboard"],
    ["Bán hàng", "point_of_sale"],
    ["Kho", "warehouse"],
    ["Báo cáo", "bar_chart"],
    ["Thêm", "more_horiz"],
  ];
  return (
    <nav className="grid grid-cols-5 border-t border-border bg-white">
      {items.map(([label, icon]) => (
        <button key={label} className={cn("flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold", active === label ? "text-primary" : "text-muted-foreground")}>
          <Icon name={icon} size={20} fill={active === label} />
          {label}
        </button>
      ))}
    </nav>
  );
}
