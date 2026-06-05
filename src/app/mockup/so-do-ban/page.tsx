"use client";

/**
 * Mockup demo Sơ đồ bàn — so sánh "Trước" vs "Sau" Sprint 5.
 * Data hardcode, không gọi DB.
 */

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type {
  CanvasTable,
} from "@/components/shared/floor-plan/floor-plan-canvas";
import {
  TableActionSheet,
  type TableActionKind,
} from "@/components/shared/floor-plan/table-action-sheet";
import type {
  FloorPlanZone,
} from "@/lib/services/supabase/floor-plan";
import type {
  FloorPlanDecoration,
} from "@/lib/services/supabase/floor-plan-decorations";

const FloorPlanCanvas = dynamic(
  () =>
    import("@/components/shared/floor-plan/floor-plan-canvas").then((m) => m.FloorPlanCanvas),
  { ssr: false, loading: () => <Loader /> },
);

// ─── Mock data 3 khu vực ───

const mockZones: FloorPlanZone[] = [
  {
    id: "z1",
    tenantId: "demo",
    branchId: "b1",
    name: "Sảnh chính",
    sortOrder: 0,
    canvasWidth: 900,
    canvasHeight: 520,
    backgroundUrl: null,
    backgroundOpacity: 30,
    gridSize: 16,
    overlayColor: "#fef3c7",
    floorLevel: 1,
    isActive: true,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "z2",
    tenantId: "demo",
    branchId: "b1",
    name: "Sân vườn",
    sortOrder: 1,
    canvasWidth: 900,
    canvasHeight: 520,
    backgroundUrl: null,
    backgroundOpacity: 30,
    gridSize: 16,
    overlayColor: "#dcfce7",
    floorLevel: 1,
    isActive: true,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "z3",
    tenantId: "demo",
    branchId: "b1",
    name: "Tầng 2",
    sortOrder: 0,
    canvasWidth: 900,
    canvasHeight: 520,
    backgroundUrl: null,
    backgroundOpacity: 30,
    gridSize: 16,
    overlayColor: "#ede9fe", // tím nhạt — phân biệt với Trệt
    floorLevel: 2,
    isActive: true,
    createdAt: "",
    updatedAt: "",
  },
];

// Sảnh chính — 8 bàn + bar + cửa
const tablesSanhChinh: CanvasTable[] = [
  { id: "t1", zoneId: "z1", shape: "round", width: 80, height: 80, rotation: 0, positionX: 80, positionY: 220, color: null, locked: false, tableNumber: 1, name: "Bàn 1", capacity: 4, status: "available" },
  { id: "t2", zoneId: "z1", shape: "round", width: 80, height: 80, rotation: 0, positionX: 200, positionY: 220, color: null, locked: false, tableNumber: 2, name: "Bàn 2", capacity: 4, status: "occupied", unpaidOrders: 1 },
  { id: "t3", zoneId: "z1", shape: "round", width: 100, height: 100, rotation: 0, positionX: 340, positionY: 210, color: null, locked: false, tableNumber: 3, name: "Bàn 3", capacity: 6, status: "available" },
  { id: "t4", zoneId: "z1", shape: "square", width: 70, height: 70, rotation: 0, positionX: 500, positionY: 220, color: null, locked: false, tableNumber: 4, name: "Bàn 4", capacity: 2, status: "reserved" },
  { id: "t5", zoneId: "z1", shape: "square", width: 70, height: 70, rotation: 0, positionX: 600, positionY: 220, color: null, locked: false, tableNumber: 5, name: "Bàn 5", capacity: 2, status: "available" },
  { id: "t6", zoneId: "z1", shape: "rect", width: 160, height: 60, rotation: 0, positionX: 80, positionY: 360, color: null, locked: false, tableNumber: 6, name: "Bàn 6", capacity: 4, status: "occupied", unpaidOrders: 1 },
  { id: "t7", zoneId: "z1", shape: "rect", width: 160, height: 60, rotation: 0, positionX: 280, positionY: 360, color: null, locked: false, tableNumber: 7, name: "Bàn 7", capacity: 4, status: "available" },
  { id: "t8", zoneId: "z1", shape: "sofa", width: 180, height: 120, rotation: 0, positionX: 670, positionY: 340, color: null, locked: false, tableNumber: 8, name: "VIP", capacity: 6, status: "occupied", unpaidOrders: 2 },
];

const decorSanhChinh: FloorPlanDecoration[] = [
  { id: "d1", zoneId: "z1", kind: "bar", label: "Quầy bar", positionX: 80, positionY: 60, width: 760, height: 60, rotation: 0, color: "#7c2d12", icon: "local_bar", locked: false, zIndex: 0 },
  { id: "d2", zoneId: "z1", kind: "door", label: "Cửa chính", positionX: 760, positionY: 470, width: 80, height: 16, rotation: 0, color: "#92400e", icon: "door_front", locked: false, zIndex: 0 },
  { id: "d3", zoneId: "z1", kind: "plant", label: null, positionX: 30, positionY: 470, width: 40, height: 40, rotation: 0, color: "#16a34a", icon: "potted_plant", locked: false, zIndex: 0 },
  { id: "d4", zoneId: "z1", kind: "plant", label: null, positionX: 440, positionY: 150, width: 40, height: 40, rotation: 0, color: "#16a34a", icon: "potted_plant", locked: false, zIndex: 0 },
  { id: "d5", zoneId: "z1", kind: "restroom", label: "Toilet", positionX: 800, positionY: 150, width: 80, height: 60, rotation: 0, color: "#64748b", icon: "wc", locked: false, zIndex: 0 },
];

// Sân vườn — bàn tròn rải rác + cây
const tablesSanVuon: CanvasTable[] = [
  { id: "g1", zoneId: "z2", shape: "round", width: 80, height: 80, rotation: 0, positionX: 100, positionY: 100, color: null, locked: false, tableNumber: 9, name: "Vườn 1", capacity: 4, status: "available" },
  { id: "g2", zoneId: "z2", shape: "round", width: 80, height: 80, rotation: 0, positionX: 280, positionY: 100, color: null, locked: false, tableNumber: 10, name: "Vườn 2", capacity: 4, status: "available" },
  { id: "g3", zoneId: "z2", shape: "round", width: 80, height: 80, rotation: 0, positionX: 460, positionY: 100, color: null, locked: false, tableNumber: 11, name: "Vườn 3", capacity: 4, status: "occupied", unpaidOrders: 1 },
  { id: "g4", zoneId: "z2", shape: "round", width: 80, height: 80, rotation: 0, positionX: 640, positionY: 100, color: null, locked: false, tableNumber: 12, name: "Vườn 4", capacity: 4, status: "available" },
  { id: "g5", zoneId: "z2", shape: "round", width: 100, height: 100, rotation: 0, positionX: 180, positionY: 270, color: null, locked: false, tableNumber: 13, name: "Vườn 5", capacity: 6, status: "occupied", unpaidOrders: 1 },
  { id: "g6", zoneId: "z2", shape: "round", width: 100, height: 100, rotation: 0, positionX: 380, positionY: 270, color: null, locked: false, tableNumber: 14, name: "Vườn 6", capacity: 6, status: "available" },
  { id: "g7", zoneId: "z2", shape: "round", width: 100, height: 100, rotation: 0, positionX: 580, positionY: 270, color: null, locked: false, tableNumber: 15, name: "Vườn 7", capacity: 6, status: "reserved" },
  { id: "g8", zoneId: "z2", shape: "rect", width: 220, height: 70, rotation: 0, positionX: 320, positionY: 420, color: null, locked: false, tableNumber: 16, name: "Bàn dài", capacity: 8, status: "available" },
];

const decorSanVuon: FloorPlanDecoration[] = [
  { id: "g_d1", zoneId: "z2", kind: "plant", label: null, positionX: 30, positionY: 30, width: 40, height: 40, rotation: 0, color: "#16a34a", icon: "potted_plant", locked: false, zIndex: 0 },
  { id: "g_d2", zoneId: "z2", kind: "plant", label: null, positionX: 30, positionY: 200, width: 40, height: 40, rotation: 0, color: "#16a34a", icon: "potted_plant", locked: false, zIndex: 0 },
  { id: "g_d3", zoneId: "z2", kind: "plant", label: null, positionX: 30, positionY: 380, width: 40, height: 40, rotation: 0, color: "#16a34a", icon: "potted_plant", locked: false, zIndex: 0 },
  { id: "g_d4", zoneId: "z2", kind: "plant", label: null, positionX: 820, positionY: 30, width: 40, height: 40, rotation: 0, color: "#16a34a", icon: "potted_plant", locked: false, zIndex: 0 },
  { id: "g_d5", zoneId: "z2", kind: "plant", label: null, positionX: 820, positionY: 200, width: 40, height: 40, rotation: 0, color: "#16a34a", icon: "potted_plant", locked: false, zIndex: 0 },
  { id: "g_d6", zoneId: "z2", kind: "plant", label: null, positionX: 820, positionY: 380, width: 40, height: 40, rotation: 0, color: "#16a34a", icon: "potted_plant", locked: false, zIndex: 0 },
  { id: "g_d7", zoneId: "z2", kind: "door", label: "Vào", positionX: 410, positionY: 10, width: 80, height: 16, rotation: 0, color: "#92400e", icon: "door_front", locked: false, zIndex: 0 },
];

// Tầng 2 — VIP, booth, sofa
const tablesTang2: CanvasTable[] = [
  { id: "v1", zoneId: "z3", shape: "sofa", width: 200, height: 140, rotation: 0, positionX: 80, positionY: 100, color: "#7c3aed", locked: false, tableNumber: 17, name: "VIP 1", capacity: 8, status: "occupied", unpaidOrders: 3 },
  { id: "v2", zoneId: "z3", shape: "sofa", width: 200, height: 140, rotation: 0, positionX: 320, positionY: 100, color: null, locked: false, tableNumber: 18, name: "VIP 2", capacity: 8, status: "available" },
  { id: "v3", zoneId: "z3", shape: "round", width: 100, height: 100, rotation: 0, positionX: 580, positionY: 110, color: null, locked: false, tableNumber: 19, name: "Bàn họp", capacity: 8, status: "reserved" },
  { id: "v4", zoneId: "z3", shape: "rect", width: 240, height: 80, rotation: 0, positionX: 80, positionY: 330, color: null, locked: false, tableNumber: 20, name: "Bàn dài 1", capacity: 6, status: "available" },
  { id: "v5", zoneId: "z3", shape: "rect", width: 240, height: 80, rotation: 0, positionX: 360, positionY: 330, color: null, locked: false, tableNumber: 21, name: "Bàn dài 2", capacity: 6, status: "occupied", unpaidOrders: 1 },
  { id: "v6", zoneId: "z3", shape: "round", width: 80, height: 80, rotation: 0, positionX: 660, positionY: 330, color: null, locked: false, tableNumber: 22, name: "Bàn 22", capacity: 4, status: "available" },
];

const decorTang2: FloorPlanDecoration[] = [
  { id: "v_d1", zoneId: "z3", kind: "stairs", label: "Cầu thang", positionX: 780, positionY: 30, width: 80, height: 60, rotation: 0, color: "#374151", icon: "stairs", locked: false, zIndex: 0 },
  { id: "v_d2", zoneId: "z3", kind: "restroom", label: "Toilet", positionX: 780, positionY: 130, width: 80, height: 60, rotation: 0, color: "#64748b", icon: "wc", locked: false, zIndex: 0 },
  { id: "v_d3", zoneId: "z3", kind: "tv", label: "TV", positionX: 100, positionY: 30, width: 180, height: 12, rotation: 0, color: "#1e293b", icon: "tv", locked: false, zIndex: 0 },
  { id: "v_d4", zoneId: "z3", kind: "window", label: null, positionX: 100, positionY: 480, width: 200, height: 12, rotation: 0, color: "#bae6fd", icon: "window", locked: false, zIndex: 0 },
  { id: "v_d5", zoneId: "z3", kind: "window", label: null, positionX: 380, positionY: 480, width: 200, height: 12, rotation: 0, color: "#bae6fd", icon: "window", locked: false, zIndex: 0 },
];

const ZONE_DATA: Record<
  string,
  { tables: CanvasTable[]; decorations: FloorPlanDecoration[] }
> = {
  z1: { tables: tablesSanhChinh, decorations: decorSanhChinh },
  z2: { tables: tablesSanVuon, decorations: decorSanVuon },
  z3: { tables: tablesTang2, decorations: decorTang2 },
};

// ─── Page ───

export default function MockupSoDoBanPage() {
  const [activeZoneId, setActiveZoneId] = useState("z1");
  const [comparisonMode, setComparisonMode] = useState<"after" | "before">("after");
  // Tap bàn → mở action sheet
  const [actionTable, setActionTable] = useState<CanvasTable | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  // Responsive width — tự cập nhật khi resize window
  const [winWidth, setWinWidth] = useState(1200);
  useEffect(() => {
    const update = () => setWinWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const activeZone = mockZones.find((z) => z.id === activeZoneId)!;
  const { tables, decorations } = ZONE_DATA[activeZoneId];

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  };

  const handleAction = (kind: TableActionKind, t: CanvasTable) => {
    const label = {
      open: "Mở đơn",
      merge: "Gộp bàn",
      transfer: "Chuyển bàn",
      "cancel-reservation": "Hủy đặt",
    }[kind];
    showToast(
      `${label} cho ${t.name || `Bàn ${t.tableNumber}`} — chức năng kết nối POS FnB thật sau.`,
    );
    setActionTable(null);
  };

  const counts = tables.reduce(
    (c, t) => {
      // "cleaning" hoặc không khớp → đếm vào "available"
      const key = (t.status === "occupied" || t.status === "reserved"
        ? t.status
        : "available") as keyof typeof c;
      c[key]++;
      return c;
    },
    { available: 0, occupied: 0, reserved: 0 },
  );

  return (
    <div className="min-h-screen bg-surface-container-low p-4 sm:p-6 space-y-4">
      {/* Header */}
      <header className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Icon name="map" size={24} className="text-primary" />
            Mockup Sơ đồ bàn
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Demo data hardcode • 3 khu vực • 22 bàn • 17 đồ trang trí
          </p>
        </div>
        <div className="inline-flex rounded-lg border bg-card p-1">
          <button
            onClick={() => setComparisonMode("before")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded transition-colors",
              comparisonMode === "before"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Trước Sprint 5
          </button>
          <button
            onClick={() => setComparisonMode("after")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded transition-colors",
              comparisonMode === "after"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Sau Sprint 5 ✨
          </button>
        </div>
      </header>

      {/* Tab khu vực */}
      <div className="flex items-center gap-2 flex-wrap bg-card border rounded-lg p-2">
        {Array.from(new Set(mockZones.map((z) => z.floorLevel)))
          .sort()
          .map((floor) => (
            <div key={floor} className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">
                {floor === 1 ? "Trệt" : `Lầu ${floor - 1}`}:
              </span>
              {mockZones
                .filter((z) => z.floorLevel === floor)
                .map((z) => (
                  <button
                    key={z.id}
                    onClick={() => setActiveZoneId(z.id)}
                    className={cn(
                      "px-3 py-1.5 rounded text-xs font-medium transition-colors",
                      activeZoneId === z.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-surface-container hover:bg-muted",
                    )}
                  >
                    {z.name} ({ZONE_DATA[z.id].tables.length} bàn)
                  </button>
                ))}
            </div>
          ))}
      </div>

      {/* Legend — 3 trạng thái chuẩn: trống (viền xanh ngọc) / phục vụ (cam) / đặt trước (xanh dương nét đứt) */}
      <div className="flex items-center gap-5 px-4 py-2 bg-card border rounded-lg flex-wrap text-xs">
        <Legend variant="empty" label="Trống" count={counts.available} />
        <Legend variant="occupied" label="Đang phục vụ" count={counts.occupied} />
        <Legend variant="reserved" label="Đặt trước" count={counts.reserved} />
      </div>

      {/* Canvas / Grid */}
      <div className="bg-card border rounded-lg p-4 overflow-auto">
        {comparisonMode === "after" ? (
          <div className="flex justify-center">
            <FloorPlanCanvas
              zone={activeZone}
              tables={tables}
              decorations={decorations}
              mode="view"
              onSelectTable={(t) => setActionTable(t)}
              containerWidth={Math.min(
                Math.max(winWidth - 60, 320),
                activeZone.canvasWidth,
              )}
            />
          </div>
        ) : (
          <BeforeGrid tables={tables} />
        )}
      </div>

      {/* Action sheet khi tap bàn */}
      <TableActionSheet
        table={actionTable}
        zoneName={actionTable ? activeZone.name : undefined}
        onAction={handleAction}
        onClose={() => setActionTable(null)}
      />

      {/* Toast nhẹ */}
      {toastMsg && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-foreground text-background px-4 py-2.5 rounded-lg shadow-2xl text-sm font-medium max-w-[90vw] text-center animate-in slide-in-from-bottom"
        >
          {toastMsg}
        </div>
      )}

      {/* Tính năng đã có */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <FeatureCard
          icon="drag_indicator"
          title="Kéo thả bàn"
          desc="Bàn đặt đúng vị trí thật, không phải grid auto"
        />
        <FeatureCard
          icon="dashboard_customize"
          title="8 mẫu bàn"
          desc="Tròn, vuông, dài, sofa góc — gắn capacity tự động"
        />
        <FeatureCard
          icon="forest"
          title="8 đồ trang trí"
          desc="Cửa, cây, quầy bar, toilet, TV, cầu thang..."
        />
        <FeatureCard
          icon="image"
          title="Ảnh nền quán"
          desc="Chụp ảnh trên xuống → kéo bàn đúng vị trí thực"
        />
        <FeatureCard
          icon="layers"
          title="Đa tầng + Khu vực"
          desc="Sảnh, Sân vườn, Tầng 2... nhóm theo tầng"
        />
        <FeatureCard
          icon="undo"
          title="Hoàn tác Ctrl+Z"
          desc="Sai 1 click — 1 lần hoàn tác về như cũ"
        />
      </div>

      <footer className="text-center text-xs text-muted-foreground py-4">
        Sau khi anh duyệt → vào <code className="bg-muted px-1.5 py-0.5 rounded">/he-thong/so-do-ban</code> hoặc{" "}
        <code className="bg-muted px-1.5 py-0.5 rounded">/cai-dat/so-do-ban</code> sửa cho quán mình.
      </footer>
    </div>
  );
}

// ─── Sub components ───

function Loader() {
  return (
    <div className="flex items-center justify-center h-[400px] text-muted-foreground">
      <Icon name="progress_activity" className="animate-spin mr-2" />
      Đang tải canvas…
    </div>
  );
}

function Legend({
  variant,
  label,
  count,
}: {
  variant: "empty" | "occupied" | "reserved";
  label: string;
  count: number;
}) {
  // Mỗi variant render đúng như bàn thật trên canvas
  const swatch =
    variant === "empty" ? (
      <span
        className="h-4 w-4 rounded-full inline-block bg-white"
        style={{ border: "2px solid #10b981" }}
      />
    ) : variant === "occupied" ? (
      <span
        className="h-4 w-4 rounded-full inline-block"
        style={{ backgroundColor: "#f59e0b", border: "2px solid #d97706" }}
      />
    ) : (
      <span
        className="h-4 w-4 rounded-full inline-block"
        style={{
          backgroundColor: "#dbeafe",
          border: "2px dashed #3b82f6",
        }}
      />
    );
  return (
    <div className="flex items-center gap-2">
      {swatch}
      <span className="font-medium">
        {label}{" "}
        <span className="text-muted-foreground font-normal">({count})</span>
      </span>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  desc,
}: {
  icon: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="border rounded-lg p-3 bg-card flex items-start gap-3">
      <div className="h-9 w-9 rounded-lg bg-primary-fixed flex items-center justify-center shrink-0">
        <Icon name={icon} size={18} className="text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

// ─── BEFORE: grid auto cũ ───
function BeforeGrid({ tables }: { tables: CanvasTable[] }) {
  return (
    <div>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
        {tables.map((t) => {
          const bg =
            t.status === "available"
              ? "bg-status-success/10 border-status-success/30"
              : t.status === "occupied"
                ? "bg-primary/10 border-primary/30"
                : t.status === "reserved"
                  ? "bg-status-warning/10 border-status-warning/30"
                  : "bg-muted border-border";
          return (
            <div
              key={t.id}
              className={cn(
                "relative flex flex-col items-center justify-center rounded-lg border-2 p-3 min-h-[96px]",
                bg,
              )}
            >
              <span className="text-xl font-bold">{t.tableNumber}</span>
              <span className="text-xs text-muted-foreground mt-0.5">{t.name}</span>
              <span className="text-[10px] text-muted-foreground mt-0.5">
                <Icon name="group" size={12} className="inline" /> {t.capacity}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground mt-4 text-center italic">
        Grid auto cũ — mọi bàn cùng kích thước, sắp xếp tự động theo lưới. Không phản ánh layout thật quán.
      </p>
    </div>
  );
}
