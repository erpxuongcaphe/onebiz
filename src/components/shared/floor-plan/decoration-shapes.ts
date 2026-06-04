/**
 * Đồ trang trí preset cho Floor Plan.
 * CEO 04/06/2026 — Sprint 5 Phase B.
 */

import type { DecorationKind } from "@/lib/services/supabase/floor-plan-decorations";

export interface DecorationPreset {
  kind: DecorationKind;
  label: string;
  icon: string;
  width: number;
  height: number;
  color: string;
}

export const DECORATION_PRESETS: DecorationPreset[] = [
  { kind: "door", label: "Cửa", icon: "door_front", width: 60, height: 16, color: "#92400e" },
  { kind: "plant", label: "Cây cảnh", icon: "potted_plant", width: 40, height: 40, color: "#16a34a" },
  { kind: "bar", label: "Quầy bar", icon: "local_bar", width: 200, height: 50, color: "#7c2d12" },
  { kind: "restroom", label: "Toilet", icon: "wc", width: 80, height: 60, color: "#64748b" },
  { kind: "window", label: "Cửa sổ", icon: "window", width: 80, height: 12, color: "#bae6fd" },
  { kind: "tv", label: "Tivi", icon: "tv", width: 60, height: 12, color: "#1e293b" },
  { kind: "stairs", label: "Cầu thang", icon: "stairs", width: 80, height: 60, color: "#374151" },
  { kind: "wall", label: "Tường", icon: "horizontal_rule", width: 120, height: 8, color: "#475569" },
];

export function getDecorationPreset(kind: DecorationKind): DecorationPreset {
  return (
    DECORATION_PRESETS.find((d) => d.kind === kind) ?? DECORATION_PRESETS[0]
  );
}
