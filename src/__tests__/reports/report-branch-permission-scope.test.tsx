import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { AuthBranchPermissionScope, AuthContext, useAuth } from "@/lib/contexts/auth-context";
import { usePermissions } from "@/lib/permissions";

function Probe() {
  const { hasPermission } = useAuth();
  const scoped = usePermissions();
  return <div>
    <span>auth:{String(hasPermission("reports.analytics"))}</span>
    <span>hook:{String(scoped.hasPermission("reports.analytics"))}</span>
    <span>detail:{String(scoped.hasPermission("reports.view_detail"))}</span>
  </div>;
}

describe("report permission scope", () => {
  it("uses the report branch even when the operational header has a different branch", () => {
    const value = {
      user: { role: "staff", isActive: true }, isLoading: false, authDataError: null,
      permissions: new Set(["reports.analytics"]),
      hasPermissionAtBranch: (code: string, branch: string | null) =>
        branch === "premium" && code === "reports.view_detail",
      hasPermissionAtBranchWithLegacy: () => false,
    } as unknown as ComponentProps<typeof AuthContext.Provider>["value"];
    const view = render(<AuthContext.Provider value={value}>
      <AuthBranchPermissionScope branchId="premium" ready><Probe /></AuthBranchPermissionScope>
    </AuthContext.Provider>);
    expect(screen.getByText("auth:false")).toBeInTheDocument();
    expect(screen.getByText("hook:false")).toBeInTheDocument();
    expect(screen.getByText("detail:true")).toBeInTheDocument();
    view.rerender(<AuthContext.Provider value={value}>
      <AuthBranchPermissionScope branchId="other" ready><Probe /></AuthBranchPermissionScope>
    </AuthContext.Provider>);
    expect(screen.getByText("detail:false")).toBeInTheDocument();
  });
});
