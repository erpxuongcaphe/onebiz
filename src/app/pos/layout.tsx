export default function PosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="h-screen flex flex-col overflow-hidden">{children}</div>;
}
