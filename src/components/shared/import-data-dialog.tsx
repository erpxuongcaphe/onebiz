"use client";

/**
 * ImportHubDialog — Trung tâm nhập dữ liệu Excel
 *
 * Thay thế ImportDataDialog cũ (AI placeholder) bằng hub schema-based:
 *  - Hiển thị 6 module có hỗ trợ import (Products, Customers, Suppliers,
 *    Initial Stock, Debt Opening, Cash Transactions).
 *  - User tải file mẫu trực tiếp, hoặc bấm "Mở trang nhập" để đi vào
 *    module tương ứng và sử dụng ImportExcelDialog ngay tại context đó.
 *  - Giữ nguyên tên export `ImportDataDialog` để không phá top-nav binding.
 */

import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { downloadTemplate } from "@/lib/excel";
import {
  productExcelSchema,
  customerExcelSchema,
  supplierExcelSchema,
  cashTransactionExcelSchema,
  debtOpeningExcelSchema,
  initialStockExcelSchema,
} from "@/lib/excel/schemas";
import type { ExcelSchema } from "@/lib/excel";

interface ImportDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ImportModule {
  id: string;
  title: string;
  icon: string;
  description: string;
  href: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: ExcelSchema<any>;
}

const IMPORT_MODULES: ImportModule[] = [
  {
    id: "products",
    title: "Sản phẩm",
    icon: "inventory_2",
    description: "Tạo SP mới / cập nhật giá theo lô. Hỗ trợ NVL và SKU.",
    href: "/hang-hoa",
    schema: productExcelSchema,
  },
  {
    id: "customers",
    title: "Khách hàng",
    icon: "group",
    description: "Import database khách từ file cũ (tên, SĐT, email, nhóm).",
    href: "/khach-hang",
    schema: customerExcelSchema,
  },
  {
    id: "suppliers",
    title: "Nhà cung cấp",
    icon: "local_shipping",
    description: "Danh sách NCC (mã, tên, SĐT, mã số thuế, liên hệ).",
    href: "/hang-hoa/nha-cung-cap",
    schema: supplierExcelSchema,
  },
  {
    id: "initial-stock",
    title: "Tồn kho đầu kỳ",
    icon: "warehouse",
    description: "Khởi tạo tồn kho khi mở chi nhánh mới / chốt kiểm kê.",
    href: "/hang-hoa/ton-kho",
    schema: initialStockExcelSchema,
  },
  {
    id: "debt-opening",
    title: "Công nợ đầu kỳ",
    icon: "receipt_long",
    description: "Số dư nợ KH / NCC tại thời điểm bắt đầu dùng hệ thống.",
    href: "/tai-chinh/cong-no",
    schema: debtOpeningExcelSchema,
  },
  {
    id: "cash-transactions",
    title: "Giao dịch sổ quỹ",
    icon: "account_balance_wallet",
    description: "Nhập phiếu thu / phiếu chi từ data của tháng cũ.",
    href: "/so-quy",
    schema: cashTransactionExcelSchema,
  },
];

export function ImportDataDialog({ open, onOpenChange }: ImportDataDialogProps) {
  const router = useRouter();

  const close = () => onOpenChange(false);

  const goToModule = (href: string) => {
    close();
    router.push(href);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Icon name="cloud_upload" />
          </div>
          <div className="flex-1 min-w-0">
            <DialogTitle>Trung tâm nhập dữ liệu Excel</DialogTitle>
            <DialogDescription className="mt-1">
              Tải file mẫu để nhập chuẩn định dạng. File mẫu & file xuất dùng
              cùng 1 schema — chỉnh sửa rồi upload lại vẫn đủ cột.
            </DialogDescription>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
          {IMPORT_MODULES.map((m) => (
            <div
              key={m.id}
              className="border rounded-lg p-3 bg-background hover:border-primary/40 transition-colors"
            >
              <div className="flex items-start gap-2.5 mb-2">
                <div className="h-9 w-9 rounded-md bg-primary-fixed text-primary flex items-center justify-center shrink-0">
                  <Icon name={m.icon} size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm leading-tight">
                    {m.title}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                    {m.description}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 mt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="flex-1 gap-1.5"
                  onClick={() => downloadTemplate(m.schema)}
                >
                  <Icon name="description" size={14} />
                  Tải mẫu
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-1.5"
                  onClick={() => goToModule(m.href)}
                >
                  <Icon name="arrow_forward" size={14} />
                  Mở trang nhập
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-md bg-primary-fixed/40 border border-primary-fixed-dim p-2.5 text-[11px] text-foreground/80 leading-snug">
          <strong className="text-primary">Quy trình:</strong> Tải mẫu →
          điền dữ liệu → vào trang tương ứng → bấm &quot;Nhập Excel&quot; →
          preview &amp; validate → xác nhận ghi DB.
        </div>

        <div className="flex justify-end mt-1">
          <Button variant="outline" onClick={close}>
            Đóng
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
