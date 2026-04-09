"use client";

// ---------------------------------------------------------------------------
// KanbanBoard — component tái sử dụng cho mọi pipeline (production, PO, deals)
// - Generic theo type T
// - Kéo thả bằng HTML5 drag API (không cần dep ngoài)
// - Callback onCardMove(itemId, fromColumnId, toColumnId) để xử lý transition
// - Tùy biến renderCard, header color theo stage color
// ---------------------------------------------------------------------------

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KanbanColumn<T> {
  id: string;
  label: string;
  color?: string;
  items: T[];
  /** Hiển thị badge mềm bên phải nếu cột không cho phép thả vào */
  readOnly?: boolean;
}

export interface KanbanBoardProps<T> {
  columns: KanbanColumn<T>[];
  getItemId: (item: T) => string;
  renderCard: (item: T) => ReactNode;
  onCardMove?: (
    itemId: string,
    fromColumnId: string,
    toColumnId: string
  ) => void | Promise<void>;
  onCardClick?: (item: T) => void;
  /** Kiểm tra xem có được phép kéo card từ column gốc sang column đích */
  canDrop?: (itemId: string, fromColumnId: string, toColumnId: string) => boolean;
  emptyMessage?: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function KanbanBoard<T>({
  columns,
  getItemId,
  renderCard,
  onCardMove,
  onCardClick,
  canDrop,
  emptyMessage = "Chưa có mục nào",
  className,
}: KanbanBoardProps<T>) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingFromCol, setDraggingFromCol] = useState<string | null>(null);
  const [hoverCol, setHoverCol] = useState<string | null>(null);

  const handleDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    itemId: string,
    columnId: string
  ) => {
    setDraggingId(itemId);
    setDraggingFromCol(columnId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", itemId);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDraggingFromCol(null);
    setHoverCol(null);
  };

  const handleDragOver = (
    e: React.DragEvent<HTMLDivElement>,
    columnId: string
  ) => {
    if (!draggingId || !draggingFromCol) return;
    if (draggingFromCol === columnId) return;
    if (canDrop && !canDrop(draggingId, draggingFromCol, columnId)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (hoverCol !== columnId) setHoverCol(columnId);
  };

  const handleDragLeave = (columnId: string) => {
    if (hoverCol === columnId) setHoverCol(null);
  };

  const handleDrop = async (
    e: React.DragEvent<HTMLDivElement>,
    columnId: string
  ) => {
    e.preventDefault();
    const itemId = draggingId ?? e.dataTransfer.getData("text/plain");
    const from = draggingFromCol;
    setDraggingId(null);
    setDraggingFromCol(null);
    setHoverCol(null);
    if (!itemId || !from || from === columnId) return;
    if (canDrop && !canDrop(itemId, from, columnId)) return;
    await onCardMove?.(itemId, from, columnId);
  };

  return (
    <div
      className={cn(
        "flex gap-3 overflow-x-auto pb-2 min-h-[400px]",
        className
      )}
    >
      {columns.map((col) => {
        const isHover = hoverCol === col.id;
        const isSource = draggingFromCol === col.id;
        const canAccept =
          draggingId &&
          draggingFromCol &&
          draggingFromCol !== col.id &&
          (!canDrop || canDrop(draggingId, draggingFromCol, col.id));

        return (
          <div
            key={col.id}
            onDragOver={(e) => handleDragOver(e, col.id)}
            onDragLeave={() => handleDragLeave(col.id)}
            onDrop={(e) => handleDrop(e, col.id)}
            className={cn(
              "w-72 shrink-0 rounded-lg border bg-muted/20 flex flex-col transition-colors",
              isHover && canAccept && "border-primary bg-primary/5",
              isSource && "opacity-60",
              col.readOnly && "border-dashed"
            )}
          >
            {/* Column header */}
            <div
              className="flex items-center gap-2 px-3 py-2 border-b sticky top-0 bg-inherit rounded-t-lg"
              style={
                col.color
                  ? { borderTopColor: col.color, borderTopWidth: 3 }
                  : undefined
              }
            >
              {col.color && (
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: col.color }}
                />
              )}
              <span className="text-sm font-semibold flex-1 truncate">
                {col.label}
              </span>
              <span className="text-xs font-medium text-muted-foreground bg-background rounded-full px-2 py-0.5 border">
                {col.items.length}
              </span>
            </div>

            {/* Cards */}
            <div className="flex-1 p-2 space-y-2 overflow-y-auto">
              {col.items.length === 0 ? (
                <div className="text-center text-xs text-muted-foreground py-6">
                  {emptyMessage}
                </div>
              ) : (
                col.items.map((item) => {
                  const id = getItemId(item);
                  const isDragging = draggingId === id;
                  return (
                    <div
                      key={id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, id, col.id)}
                      onDragEnd={handleDragEnd}
                      onClick={() => onCardClick?.(item)}
                      className={cn(
                        "rounded-md border bg-background p-2.5 text-sm shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md hover:border-primary/40 transition-all",
                        isDragging && "opacity-40",
                        onCardClick && "cursor-pointer"
                      )}
                    >
                      {renderCard(item)}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
