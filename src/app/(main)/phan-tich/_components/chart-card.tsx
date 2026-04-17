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
    <div className="bg-surface-container-lowest rounded-xl ambient-shadow p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-base font-medium text-on-surface">{title}</h3>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}
