import { SettingsWorkspace } from "@/components/shared/settings-workspace";

export default function SystemLayout({ children }: { children: React.ReactNode }) {
  return <SettingsWorkspace wide>{children}</SettingsWorkspace>;
}
