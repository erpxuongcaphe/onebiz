"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

interface FnbPinHandoverDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cashierName: string;
  onCloseShiftFirst: () => void;
  onContinue: () => void;
}

/**
 * Xác nhận trước khi đổi PIN lúc ca hiện tại còn mở.
 *
 * Giỏ tạm là tài sản vận hành của chi nhánh nên được giữ để người kế tiếp
 * tiếp tục phục vụ khách. Ca và tiền quỹ lại thuộc đúng thu ngân đã mở ca,
 * không được ngầm chuyển chủ chỉ vì một lần đổi PIN.
 */
export function FnbPinHandoverDialog({
  open,
  onOpenChange,
  cashierName,
  onCloseShiftFirst,
  onContinue,
}: FnbPinHandoverDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="switch_account" size={18} className="text-primary" />
            Bàn giao quầy
          </DialogTitle>
          <DialogDescription>
            Ca của {cashierName} đang mở.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm text-muted-foreground">
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-foreground">
            Giỏ tạm của chi nhánh sẽ được giữ để nhân viên tiếp nhận phục vụ
            tiếp khách đang chờ.
          </div>
          <p>
            Đổi PIN không chuyển ca, tiền quỹ hoặc các giao dịch đã ghi. Nhân
            viên tiếp nhận mở ca của mình trước khi thanh toán để sổ ca và
            nhật ký vẫn đúng người thực hiện.
          </p>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={onCloseShiftFirst}
          >
            <Icon name="logout" size={16} className="mr-1" />
            Đóng ca trước
          </Button>
          <Button type="button" className="min-h-11" onClick={onContinue}>
            <Icon name="switch_account" size={16} className="mr-1" />
            Bàn giao bằng PIN
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
