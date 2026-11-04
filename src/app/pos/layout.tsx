export default function PosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="h-dvh flex flex-col overflow-hidden">{children}</div>;
}
