import { ReportShell } from "@/components/shared/report/report-shell";

export default function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ReportShell>{children}</ReportShell>;
}