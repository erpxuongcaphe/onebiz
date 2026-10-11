import { describe, expect, it } from "vitest";
import { canSeeNavLeaf, getNavLinkTarget, sidebarNavGroups } from "@/components/shared/nav-config";

describe("ERP entry to operations Hub", () => {
  const entry = sidebarNavGroups.find(group => group.label === "Tổng quan")?.items?.find(item => item.href === "/hub");

  it("provides the same labelled entry to desktop and mobile navigation", () => {
    expect(entry).toMatchObject({ label: "Hub vận hành", href: "/hub", permission: "ops.view", exact: true });
  });

  it("does not expose the shortcut without Hub view permission", () => {
    expect(entry).toBeDefined();
    expect(canSeeNavLeaf(entry!, () => false)).toBe(false);
    expect(canSeeNavLeaf(entry!, code => code === "ops.work")).toBe(false);
  });

  it("shows the shortcut with Hub view permission", () => {
    expect(canSeeNavLeaf(entry!, code => code === "ops.view")).toBe(true);
  });

  it("keeps navigation in the shared authenticated tab", () => {
    expect(getNavLinkTarget(entry?.mode)).toBe("_self");
  });
});
