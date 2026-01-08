"use client";

import { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description?: string;
    confirmText?: string;
    cancelText?: string;
    variant?: 'default' | 'destructive';
    onConfirm: () => void | Promise<void>;
    loading?: boolean;
}

export function ConfirmDialog({
    open,
    onOpenChange,
    title,
    description,
    confirmText = "Xác nhận",
    cancelText = "Hủy",
    variant = 'default',
    onConfirm,
    loading = false
}: ConfirmDialogProps) {
    // Close on Escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && open) {
                onOpenChange(false);
            }
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [open, onOpenChange]);

    // Lock body scroll when dialog is open
    useEffect(() => {
        if (open) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [open]);

    if (!open) return null;

    const handleConfirm = async () => {
        await onConfirm();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={() => onOpenChange(false)}
            />

            {/* Dialog */}
            <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full animate-in zoom-in-95 fade-in duration-200">
                {/* Close button */}
                <button
                    onClick={() => onOpenChange(false)}
                    className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                    disabled={loading}
                >
                    <X className="w-4 h-4 text-slate-400" />
                </button>

                {/* Content */}
                <div className="p-6">
                    {/* Icon & Title */}
                    <div className="flex items-start gap-4 mb-4">
                        <div className={cn(
                            "flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center",
                            variant === 'destructive'
                                ? "bg-red-100"
                                : "bg-blue-100"
                        )}>
                            <AlertTriangle className={cn(
                                "w-6 h-6",
                                variant === 'destructive'
                                    ? "text-red-600"
                                    : "text-blue-600"
                            )} />
                        </div>
                        <div className="flex-1 pt-1">
                            <h3 className="text-lg font-semibold text-slate-900">
                                {title}
                            </h3>
                            {description && (
                                <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                                    {description}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 mt-6">
                        <button
                            onClick={() => onOpenChange(false)}
                            disabled={loading}
                            className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
                        >
                            {cancelText}
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={loading}
                            className={cn(
                                "flex-1 px-4 py-2.5 text-sm font-medium text-white rounded-xl transition-all disabled:opacity-50",
                                variant === 'destructive'
                                    ? "bg-red-600 hover:bg-red-700 hover:shadow-lg hover:shadow-red-500/30"
                                    : "bg-blue-600 hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-500/30"
                            )}
                        >
                            {loading ? "Đang xử lý..." : confirmText}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
