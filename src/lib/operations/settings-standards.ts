import { categories, type Standard } from "./contracts";
import type { QualityWorkspace } from "./quality-contracts";

type SettingsQuality = Pick<QualityWorkspace, "assignments" | "catalog" | "groups">;

// Reuse the branch-scoped read already loaded by the QC workspace. No extra request.
export function settingsStandards(standards: Standard[], quality?: SettingsQuality) {
  return standards.map(standard => {
    const assignment = quality?.assignments.find(item => item.family_id === standard.family_id);
    const catalog = quality?.catalog.find(item => item.standard_id === standard.id)
      ?? quality?.catalog.find(item => item.family_id === standard.family_id);
    const group = quality?.groups?.find(item => `group:${item.id}` === catalog?.category);
    return {
      ...standard,
      manager_ids: assignment ? assignment.manager_ids : [standard.assignee_id],
      category: catalog?.category ?? "",
      categoryLabel: catalog?.group_title || group?.title
        || categories[catalog?.category as keyof typeof categories] || "Chưa phân loại",
    };
  });
}

export function standardCategoryOptions(standards: ReturnType<typeof settingsStandards>) {
  return Object.fromEntries(
    standards.filter(item => item.category)
      .map(item => [item.category, item.categoryLabel])
      .sort((a, b) => a[1].localeCompare(b[1], "vi")),
  );
}
