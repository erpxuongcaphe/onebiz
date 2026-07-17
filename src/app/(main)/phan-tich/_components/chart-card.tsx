"use client";

interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

// Stitch style: rounded-xl + ambient-shadow (không border cứng), padding 5 (24px),
// title text-base font-medium (Stitch dùng font weight nhẹ hơn bold).
export function ChartCard({ title, subtitle, children, actions }: ChartCardProps) {
  return (
    <div className="bg-surface-container-lowest rounded-lg ambient-shadow p-4 lg:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold leading-5 text-on-surface">{title}</h3>
          {subtitle && (
            <p className="mt-1 text-xs leading-4 text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}
