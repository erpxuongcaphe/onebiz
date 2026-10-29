"use client";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export function RemoveTransactionLineButton({
  productName, onClick, className, disabled,
}: {
  productName: string;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const label = `Xóa ${productName}`;
  return (
    <Button type="button" variant="ghost" size="icon"
      className={cn("justify-self-end text-muted-foreground hover:bg-destructive/10 hover:text-destructive", className)}
      aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <Icon name="delete" size={18} />
    </Button>
  );
}
