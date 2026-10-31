import type { MenuCostIssue } from "@/lib/services/supabase/fnb-menu-estimates";

export const MENU_COST_ISSUES: Record<MenuCostIssue["reason"], { label: string; action: string }> = {
  invalid_recipe: { label: "Thiếu dữ liệu công thức hoặc quy đổi", action: "Kiểm tra định lượng, sản lượng thu hồi và đơn vị đầu ra." },
  recipe_cycle: { label: "Công thức bị vòng lặp", action: "Kiểm tra thành phần BTP tham chiếu lẫn nhau." },
  recipe_depth: { label: "Công thức vượt giới hạn nhiều cấp", action: "Kiểm tra cấu trúc công thức BTP." },
  missing_component: { label: "Thiếu thành phần", action: "Kiểm tra liên kết công thức." },
  invalid_quantity: { label: "Định lượng không hợp lệ", action: "Đối chiếu định lượng và đơn vị quy đổi." },
  missing_cost: { label: "Thiếu nguồn giá", action: "Đối chiếu phiếu nhập, mẻ sản xuất hoặc giá vốn đầu kỳ." },
  invalid_cost: { label: "Dữ liệu giá vốn không hợp lệ", action: "Đối chiếu sổ giá vốn trước khi sử dụng." },
  negative_stock: { label: "Âm tồn", action: "Đối chiếu mẻ sản xuất, phiếu nhập và tiêu hao." },
  quantity_mismatch: { label: "Lệch lượng giá vốn", action: "Đối chiếu nhập, tiêu hao, kiểm kê và chứng từ hủy." },
};

export function menuCostIssuesText(issues: MenuCostIssue[] = []) {
  return issues.map(issue => `${issue.code ? `${issue.code} · ` : ""}${issue.name}: ${MENU_COST_ISSUES[issue.reason].label}`).join("; ");
}
