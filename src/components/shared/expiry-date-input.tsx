"use client";

import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { DateTimeInput } from "@/components/shared/date-time-input";

type Props = Omit<ComponentProps<typeof Input>, "type" | "value" | "onChange" | "defaultValue"> & {
  value?: string | null;
  onValueChange: (value: string) => void;
};

/** Date + optional hour: legacy date-only expiry remains date-only until the user enters an hour. */
export function ExpiryDateInput(props: Props) {
  return <DateTimeInput {...props} aria-label={props["aria-label"] ?? "Hạn sử dụng"} />;
}
