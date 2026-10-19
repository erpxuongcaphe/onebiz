import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SettingsView } from "@/components/operations/workspace";
import type { Standard, Workspace } from "@/lib/operations/contracts";
import type { QualityWorkspace } from "@/lib/operations/quality-contracts";
import { initialFilters, matchesConfiguration } from "@/lib/operations/filters";
import { settingsStandards, standardCategoryOptions } from "@/lib/operations/settings-standards";
import { filterPeople } from "@/lib/operations/people-filters";

vi.mock("@/components/ui/icon", () => ({ Icon: () => null }));
afterEach(cleanup);
const standard = { id: "standard", family_id: "family", branch_id: "premium", title: "Khu vực pha chế", assignee_id: "thu", status: "approved", frequency: "daily", effective_from: "2026-10-20", revision: 1, scope: "common", criteria: [] } as unknown as Standard;
const quality = {
  assignments: [{ family_id: "family", manager_ids: ["tien", "thu"] }],
  catalog: [{ standard_id: "standard", family_id: "family", category: "group:space", group_title: "Không gian và trải nghiệm" }],
  groups: [{ id: "space", title: "Không gian và trải nghiệm", active: true, version: 1 }],
} as Pick<QualityWorkspace, "assignments" | "catalog" | "groups">;
const workspace = {
  standards: [standard], people: [{ id: "tien", name: "Tiên" }, { id: "thu", name: "Thư" }, { id: "test", name: "Quản lý Test" }],
  members: [{ user_id: "tien", member_role: "manager", active: true }, { user_id: "thu", member_role: "manager", active: true }, { user_id: "test", member_role: "manager", active: true }],
  policies: [], runs: [], todos: [], period: "2026-10", isCeo: true,
} as unknown as Workspace;

describe("shared manager and Excel classification regression", () => {
  it("matches every assigned manager, not only the legacy primary assignee", () => {
    const [item] = settingsStandards([standard], quality);
    for (const id of ["tien", "thu"]) expect(matchesConfiguration(item, { ...initialFilters("settings"), assignee: id }, "", "2026-10")).toBe(true);
    expect(matchesConfiguration(item, { ...initialFilters("settings"), assignee: "test" }, "", "2026-10")).toBe(false);
    expect(standard).not.toHaveProperty("manager_ids");
  });
  it("uses shared assignments as authoritative and falls back only when absent", () => {
    expect(settingsStandards([standard])[0].manager_ids).toEqual(["thu"]);
    const [empty] = settingsStandards([standard], { ...quality, assignments: [{ family_id: "family", manager_ids: [] }] });
    expect(matchesConfiguration(empty, { ...initialFilters("settings"), assignee: "thu" }, "", "2026-10")).toBe(false);
  });
  it("uses configured group labels without hardcoding the six Excel names", () => {
    const items = settingsStandards([standard], quality);
    expect(standardCategoryOptions(items)).toEqual({ "group:space": "Không gian và trải nghiệm" });
    expect(matchesConfiguration(items[0], { ...initialFilters("settings"), category: "group:space", assignee: "tien", frequency: "daily" }, "pha", "2026-10")).toBe(true);
    expect(matchesConfiguration(items[0], { ...initialFilters("settings"), category: "maintenance" }, "", "2026-10")).toBe(false);
    expect(standardCategoryOptions(settingsStandards([standard], { ...quality, catalog: [] }))).toEqual({});
  });
  it("retains historical people in filters without changing assignment eligibility", () => {
    expect(filterPeople({ ...workspace, members: [], standards: settingsStandards(workspace.standards, quality) }).map(p => p.id)).toEqual(["tien", "thu"]);
  });
  it("reproduces CEO selection and combines manager, classification, reset and member filters", () => {
    const onEdit = vi.fn(); const onSave = vi.fn();
    render(<SettingsView data={workspace} qualityData={quality} canConfigure={false} canPropose={false} canManageMembers={false} busy={false} onEdit={onEdit} onSave={onSave} includeRewardPolicies={false}/>);
    expect(screen.getByText(/Tiên, Thư/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Người chịu trách nhiệm Chọn người" }));
    fireEvent.click(screen.getByRole("button", { name: "Tiên" }));
    expect(screen.getByRole("heading", { name: "Standard Working · 1" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Phân loại"), { target: { value: "group:space" } });
    expect(screen.getByRole("heading", { name: "Standard Working · 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xem chi tiết" }));
    expect(onEdit.mock.calls[0][0].standard.manager_ids).toEqual(["tien", "thu"]);
    fireEvent.click(screen.getByRole("button", { name: "Đặt lại" }));
    expect(screen.getByLabelText("Phân loại")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Người chịu trách nhiệm Chọn người" }));
    fireEvent.click(screen.getByRole("button", { name: "Quản lý Test" }));
    expect(screen.getByRole("heading", { name: "Standard Working · 0" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Danh mục thiết lập"), { target: { value: "members" } });
    expect(screen.queryByLabelText("Phân loại")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Phân công chi nhánh · 3" })).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});
