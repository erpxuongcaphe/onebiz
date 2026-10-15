"use client"

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
    "h-10 rounded-lg border border-input bg-surface-container-lowest px-3 py-2 shadow-none " +
    "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20",
  underline:
    "h-10 border-0 border-b-2 border-input bg-surface-container-low px-3 py-2 rounded-t-lg " +
    "focus-visible:border-primary focus-visible:bg-surface-container",
  ghost:
    "h-8 border border-transparent bg-transparent px-2 py-1 rounded-lg " +
    "hover:border-border focus-visible:border-primary focus-visible:bg-surface-container-lowest focus-visible:ring-1 focus-visible:ring-primary/20",
}

function Input({ className, type, variant = "default", ...props }: InputProps) {
  const classes = cn(
    "w-full min-w-0 text-sm pointer-coarse:min-h-[44px] transition-colors outline-none " +
      "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground " +
      "placeholder:text-muted-foreground " +
      "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 " +
      "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
    variantClass[variant],
    className,
  )
  if (type === "date" || type === "datetime-local" || type === "time") {
    return <NativeDateInput {...props} type={type} className={classes} data-slot="input" data-variant={variant} />
  }
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      data-variant={variant}
      className={cn(
        "w-full min-w-0 text-sm pointer-coarse:min-h-[44px] transition-colors outline-none " +
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

/** Keep the browser's day/month/year editing buffer intact while synchronizing external values. */
function NativeDateInput({ value, defaultValue, ref, type = "date", ...props }: React.ComponentProps<"input">) {
  const element = React.useRef<HTMLInputElement | null>(null)
  const [initialValue] = React.useState(() => value ?? defaultValue)
  React.useEffect(() => {
    if (value === undefined || !element.current) return
    const next = value == null ? "" : String(value)
    // Assigning even the same date resets native date segments and moves the caret.
    if (element.current.value !== next) element.current.value = next
  }, [value])
  return (
    <input
      {...props}
      type={type}
      defaultValue={initialValue}
      title={props.title ?? (type === "time" ? "Nhập HH:mm hoặc chọn giờ" : type === "datetime-local" ? "Nhập DD/MM/YYYY HH:mm hoặc chọn lịch" : "Nhập DD/MM/YYYY hoặc chọn lịch")}
      ref={(node) => {
        element.current = node
        if (typeof ref === "function") return ref(node)
        if (ref) ref.current = node
      }}
    />
  )
}

export { Input }
