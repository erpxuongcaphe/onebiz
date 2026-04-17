import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

// Stitch style variants:
// - default: outlined bg-surface-container-lowest rounded-xl — dùng cho forms, filters chính
// - underline: Material Design 3 filled-underline — dùng cho login, đơn giản
// - ghost: không border, dùng cho inline editing trong table
type InputVariant = "default" | "underline" | "ghost"

interface InputProps extends React.ComponentProps<"input"> {
  variant?: InputVariant
}

const variantClass: Record<InputVariant, string> = {
  default:
    "h-10 rounded-xl border border-input bg-surface-container-lowest px-3.5 py-2 shadow-none " +
    "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20",
  underline:
    "h-11 border-0 border-b-2 border-input bg-surface-container-low px-3 py-2 rounded-t-md " +
    "focus-visible:border-primary focus-visible:bg-surface-container",
  ghost:
    "h-9 border border-transparent bg-transparent px-2 py-1 rounded-lg " +
    "hover:border-border focus-visible:border-primary focus-visible:bg-surface-container-lowest focus-visible:ring-1 focus-visible:ring-primary/20",
}

function Input({ className, type, variant = "default", ...props }: InputProps) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      data-variant={variant}
      className={cn(
        "w-full min-w-0 text-sm transition-colors outline-none " +
          "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground " +
          "placeholder:text-muted-foreground " +
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 " +
          "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
        variantClass[variant],
        className
      )}
      {...props}
    />
  )
}

export { Input }
