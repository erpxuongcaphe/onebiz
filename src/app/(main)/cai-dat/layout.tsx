import { SettingsWorkspace } from "@/components/shared/settings-workspace";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsWorkspace>{children}</SettingsWorkspace>;
}
