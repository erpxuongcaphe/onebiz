/**
 * Icon — Material Symbols Outlined wrapper cho Stitch UI migration.
 *
 * Dùng Google Fonts Material Symbols (variable axes: wght, FILL, opsz, GRAD).
 * Tên icon dùng snake_case theo chuẩn Material (VD "shopping_cart", "trending_up").
 *
 * Codemod `scripts/migrate-icons.ts` sẽ tự map lucide-react → tên Material tương ứng.
 *
 * ```tsx
 * <Icon name="shopping_cart" />
 * <Icon name="trending_up" size={20} fill />
 * <Icon name="delete" className="text-destructive" weight={600} />
 * ```
 */

import * as React from "react";
import { cn } from "@/lib/utils";

export interface IconProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Tên icon theo Material Symbols (snake_case), VD "shopping_cart". */
  name: string;
  /** Size tính bằng px. Default 20. */
  size?: number;
  /**
   * Axis FILL của Material Symbols (0 = outline, 1 = filled).
   * Boolean shorthand: true = fill, false = outline.
   */
  fill?: boolean;
  /** Axis wght (100-700). Default 400. */
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700;
  /** Axis GRAD (-25 low emphasis → 200 high emphasis). */
  grade?: number;
}

export function Icon({
  name,
  size = 20,
  fill = false,
  weight = 400,
  grade = 0,
  className,
  style,
  ...props
}: IconProps) {
  // Material Symbols dùng font-variation-settings inline để điều khiển axes.
  const fontVariationSettings = `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'GRAD' ${grade}, 'opsz' ${size}`;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "material-symbols-outlined inline-block select-none leading-none",
        className,
      )}
      style={{
        fontSize: `${size}px`,
        fontVariationSettings,
        ...style,
      }}
      {...props}
    >
      {name}
    </span>
  );
}
