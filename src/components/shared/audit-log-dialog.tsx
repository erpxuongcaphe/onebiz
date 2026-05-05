"use client";

/**
 * AuditLogDialog — standalone dialog wrap AuditHistoryTab cho row actions.
 *
 * Sprint UX-1 Stage 3 (CEO 04/05/2026): trước đây audit log chỉ embed trong
 * inline detail panel tab "Lịch sử" → user phải expand row + click tab.
 *
 * Component này expose audit log qua row action shortcut → 1 click ngay.
 *
 * Usage:
 * ```tsx
 * const [auditOpen, setAuditOpen] = useState<{type: string; id: string} | null>(null);
 *
 * // In rowActions:
 * onAuditLog: () => setAuditOpen({type: "invoice", id: row.id})
 *
 * // Render:
 * {auditOpen && (
 *   <AuditLogDialog
 *     entityType={auditOpen.type}
 *     entityId={auditOpen.id}
 *     onClose={() => setAuditOpen(null)}
 *   />
 * )}
 * ```
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { AuditHistoryTab } from "./inline-detail-panel/audit-history-tab";

interface AuditLogDialogProps {
  entityType: string;
  entityId: string;
  /** Mã/code hiển thị trên title (vd "HD000123"). */
  entityCode?: string;
  /** Limit bản ghi (default 50). */
  limit?: number;
  onClose: () => void;
}

export function AuditLogDialog({
  entityType,
  entityId,
  entityCode,
  limit = 50,
  onClose,
}: AuditLogDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2">
            <Icon name="history" size={20} className="text-primary" />
            Lịch sử thay đổi
            {entityCode && (
              <span className="font-mono text-sm text-muted-foreground font-normal">
                · {entityCode}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5">
          <AuditHistoryTab
            entityType={entityType}
            entityId={entityId}
            limit={limit}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
