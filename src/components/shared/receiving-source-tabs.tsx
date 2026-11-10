import Link from 'next/link';

export function ReceivingSourceTabs({ source, branch }: { source: 'internal' | 'supplier' | 'returns'; branch?: string }) {
  return <nav aria-label="Nguồn nhập hàng" className="flex flex-wrap gap-x-4 border-b px-1">
    {([
      ['internal', 'Nhận nội bộ', `/hang-hoa/nhap-hang/noi-bo${branch ? `?branch=${encodeURIComponent(branch)}` : ''}`],
      ['supplier', 'Nhập nhà cung cấp', `/hang-hoa/nhap-hang${branch ? `?branch=${encodeURIComponent(branch)}` : ''}`],
      ['returns', 'Trả nội bộ', `/hang-hoa/nhap-hang/tra-noi-bo${branch ? `?branch=${encodeURIComponent(branch)}` : ''}`],
    ] as const).map(([id, label, href]) => <Link key={id} href={href} aria-current={source === id ? 'page' : undefined}
      className={`border-b-2 py-3 text-sm font-medium ${source === id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{label}</Link>)}
  </nav>;
}
