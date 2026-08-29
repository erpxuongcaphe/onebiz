import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(file, "utf8");
const floorPlanService = read("src/lib/services/supabase/floor-plan.ts");
const editor = read("src/components/shared/floor-plan/floor-plan-editor.tsx");
const canvas = read("src/components/shared/floor-plan/floor-plan-canvas.tsx");
const posFloorPlan = read("src/app/pos/fnb/components/table-floor-plan.tsx");
const nav = read("src/components/shared/nav-config.ts");

describe("Sơ đồ bàn — hợp đồng vận hành editor", () => {
  it("đọc đủ tên, số bàn và trạng thái để bàn có nhãn trên canvas", () => {
    expect(floorPlanService).toContain("table_number, name, capacity, status");
    expect(floorPlanService).toContain("tableNumber: r.table_number");
    expect(floorPlanService).toContain("name: r.name");
    expect(floorPlanService).toContain("status: r.status");
  });

  it("đánh số bàn theo toàn chi nhánh, không theo khu đang mở", () => {
    expect(editor).toContain("getTablesByBranch(branchId)");
    expect(editor).toContain("const nextTableNumber = branchTables.reduce");
    expect(editor).toContain("name: `Bàn ${nextTableNumber}`");
    expect(editor).not.toContain("tableNumber: tables.length + 1");
  });

  it("vật trang trí có điểm mở khóa và tối thiểu 4px khi kéo hoặc resize", () => {
    expect(editor).toContain("Vật đang chọn");
    expect(editor).toContain("Đang khoá vị trí");
    expect(canvas).toContain("const newWidth = Math.max(4");
    expect(canvas).toContain("const minimum = selectedDecorationId ? 4 : 40");
  });

  it("mọi hình trang trí có hit-area đầy đủ để chọn và kéo", () => {
    expect(canvas).toContain("hitFunc={(context, shape) => {");
    expect(canvas).toContain("context.rect(0, 0, w, h)");
    expect(canvas).toContain("context.fillStrokeShape(shape)");
  });

  it("POS chỉ đọc cùng vật thể đã lưu từ sơ đồ quản trị", () => {
    expect(posFloorPlan).toContain("getDecorationsByZone(activeZoneId)");
    expect(posFloorPlan).toContain("const [decorations, setDecorations]");
    expect(posFloorPlan).toContain("decorations={decorations}");
    expect(posFloorPlan).toContain('mode="view"');
  });

  it("Cài đặt in ấn có lối vào trực tiếp từ menu Hệ thống", () => {
    expect(nav).toContain('label: "Cài đặt in ấn", href: "/cai-dat/in-an", icon: "print"');
  });
});
