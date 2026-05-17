"use client";

/**
 * ClientChartContainer — wrapper ResponsiveContainer client-only (Day 17/05/2026).
 *
 * Fix Recharts warning "width(-1) and height(-1)" trong build static
 * prerendering. Chỉ render sau khi DOM mount → ResponsiveContainer đo
 * được parent thật, không còn ra -1.
 */

import { useEffect, useState, type ReactNode } from "react";
import {
  ResponsiveContainer,
  type ResponsiveContainerProps,
} from "recharts";

type Props = Omit<ResponsiveContainerProps, "children"> & {
  children: ReactNode;
};

export function ClientChartContainer({ children, ...rest }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    // Trong khi chưa mount client → render placeholder bằng chiều cao parent
    return <div className="w-full h-full" aria-hidden="true" />;
  }

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <ResponsiveContainer
      width="100%"
      height="100%"
      minWidth={0}
      minHeight={0}
      {...rest}
    >
      {children as React.ReactElement}
    </ResponsiveContainer>
  );
}
