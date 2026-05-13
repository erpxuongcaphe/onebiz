"use client";

/**
 * PosPinSwitchDialog — chọn account + nhập PIN để switch user trên POS FnB.
 *
 * Sprint B.5 (CEO 12/05/2026, Approach Z): thay vì cashier logout + login
 * email/password (~30-45s), bấm icon account_circle ở header POS → mở dialog
 * này → chọn tên → nhập PIN 6 số → swap session → reload POS với user mới.
 *
 * Flow:
 *   1. Mount: gọi listPosPinUsers(branchId) → list user có PIN
 *   2. User chọn account → step 2 (nhập PIN)
 *   3. Nhập PIN → verifyPosPinAndSwitch → server verify + swap session
 *   4. onSuccess callback → caller reload POS (window.location.reload)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  listPosPinUsers,
  verifyPosPinAndSwitch,
  type PosPinUser,
  type PosPinSwitchResult,
} from "@/lib/services/supabase/pos-pin";

interface PosPinSwitchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
  /** ID user đang login — để loại khỏi list (không tự switch về mình). */
  currentUserId?: string;
  /** Callback chạy sau switch thành công. Caller nên reload POS. */
  onSwitched: (result: PosPinSwitchResult) => void;
}

type Step = "select" | "pin";

export function PosPinSwitchDialog({
  open,
  onOpenChange,
  branchId,
  currentUserId,
  onSwitched,
}: PosPinSwitchDialogProps) {
  const [step, setStep] = useState<Step>("select");
  const [users, setUsers] = useState<PosPinUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUser, setSelectedUser] = useState<PosPinUser | null>(null);

  const [pinDigits, setPinDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinRefs = useRef<(HTMLInputElement | null)[]>([]);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const data = await listPosPinUsers(branchId);
      setUsers(data.filter((u) => u.id !== currentUserId));
    } catch (err) {
      console.warn("[PosPinSwitch] load users failed:", err);
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  }, [branchId, currentUserId]);

  useEffect(() => {
    if (!open) return;
    setStep("select");
    setSelectedUser(null);
    setPinDigits(["", "", "", "", "", ""]);
    setError(null);
    loadUsers();
  }, [open, loadUsers]);

  const pin = pinDigits.join("");
  const pinReady = pin.length === 6;

  const handleSelectUser = (user: PosPinUser) => {
    if (user.isLocked) return;
    setSelectedUser(user);
    setStep("pin");
    setError(null);
    setPinDigits(["", "", "", "", "", ""]);
    setTimeout(() => pinRefs.current[0]?.focus(), 80);
  };

  const handleVerify = useCallback(async () => {
    if (!pinReady || !selectedUser || verifying) return;
    setVerifying(true);
    setError(null);
    try {
      const result = await verifyPosPinAndSwitch(selectedUser.id, pin, branchId);
      onSwitched(result);
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "PIN không đúng";
      setError(msg);
      setPinDigits(["", "", "", "", "", ""]);
      pinRefs.current[0]?.focus();
    } finally {
      setVerifying(false);
    }
  }, [pinReady, selectedUser, verifying, pin, branchId, onSwitched, onOpenChange]);

  const handleDigitChange = (index: number, value: string) => {
    const sanitized = value.replace(/\D/g, "").slice(0, 1);
    const next = [...pinDigits];
    next[index] = sanitized;
    setPinDigits(next);
    setError(null);
    if (sanitized && index < 5) {
      pinRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !pinDigits[index] && index > 0) {
      pinRefs.current[index - 1]?.focus();
    }
    if (e.key === "Enter" && pinReady) handleVerify();
    if (e.key === "ArrowLeft" && index > 0) pinRefs.current[index - 1]?.focus();
    if (e.key === "ArrowRight" && index < 5) pinRefs.current[index + 1]?.focus();
  };

  const handleKeypadPress = (digit: string) => {
    const firstEmpty = pinDigits.findIndex((d) => !d);
    if (firstEmpty === -1) return;
    const next = [...pinDigits];
    next[firstEmpty] = digit;
    setPinDigits(next);
    setError(null);
    if (firstEmpty < 5) {
      pinRefs.current[firstEmpty + 1]?.focus();
    }
  };

  const handleBackspace = () => {
    const lastFilled = [...pinDigits].reverse().findIndex((d) => d);
    if (lastFilled === -1) return;
    const realIdx = 5 - lastFilled;
    const next = [...pinDigits];
    next[realIdx] = "";
    setPinDigits(next);
    pinRefs.current[realIdx]?.focus();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="switch_account" size={18} className="text-primary" />
            {step === "select" ? "Chọn nhân viên" : `Nhập PIN — ${selectedUser?.fullName}`}
          </DialogTitle>
          <DialogDescription>
            {step === "select"
              ? "Chọn tên để switch user trên POS FnB. Chỉ user đã được đặt PIN mới hiện ở đây."
              : "Nhập PIN 6 số. Sai 10 lần sẽ bị khoá 15 phút."}
          </DialogDescription>
        </DialogHeader>

        {step === "select" ? (
          <div className="py-2">
            {loadingUsers ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <Icon name="progress_activity" size={20} className="inline-block animate-spin" />
                <div className="mt-2">Đang tải danh sách...</div>
              </div>
            ) : users.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Chưa có user nào được đặt PIN tại chi nhánh này. Quản lý vào{" "}
                <code className="text-xs bg-muted px-1 rounded">/he-thong/users</code> để đặt PIN.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {users.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => handleSelectUser(u)}
                    disabled={u.isLocked}
                    className={cn(
                      "w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left",
                      "hover:border-primary hover:bg-primary/5",
                      u.isLocked && "opacity-50 cursor-not-allowed border-status-error/30 bg-status-error/5",
                    )}
                  >
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-semibold shrink-0">
                      {u.fullName.split(" ").map((n) => n[0]).slice(-2).join("")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{u.fullName}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {u.roleName ?? u.role}
                      </div>
                    </div>
                    {u.isLocked ? (
                      <span className="text-[11px] text-status-error flex items-center gap-1 shrink-0">
                        <Icon name="lock" size={12} /> Đang bị khoá
                      </span>
                    ) : (
                      <Icon name="chevron_right" size={16} className="text-muted-foreground" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="flex justify-center gap-2">
              {pinDigits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    pinRefs.current[i] = el;
                  }}
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={1}
                  value={d}
                  disabled={verifying}
                  onChange={(e) => handleDigitChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  className={cn(
                    "h-14 w-12 rounded-lg border-2 text-center text-2xl font-bold transition-colors",
                    "focus:outline-none focus:ring-2 focus:ring-primary/40",
                    d
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border bg-surface",
                    error && "border-status-error bg-status-error/5",
                  )}
                />
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2 max-w-[280px] mx-auto">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => handleKeypadPress(d)}
                  disabled={verifying || pinReady}
                  className="h-12 rounded-lg border border-border bg-surface hover:bg-surface-container text-xl font-medium disabled:opacity-50"
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setStep("select")}
                disabled={verifying}
                className="h-12 rounded-lg border border-border bg-surface hover:bg-surface-container text-xs font-medium text-muted-foreground"
              >
                <Icon name="arrow_back" size={16} />
              </button>
              <button
                type="button"
                onClick={() => handleKeypadPress("0")}
                disabled={verifying || pinReady}
                className="h-12 rounded-lg border border-border bg-surface hover:bg-surface-container text-xl font-medium disabled:opacity-50"
              >
                0
              </button>
              <button
                type="button"
                onClick={handleBackspace}
                disabled={verifying}
                className="h-12 rounded-lg border border-border bg-surface hover:bg-surface-container text-xs font-medium text-muted-foreground"
              >
                <Icon name="backspace" size={16} />
              </button>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-xs text-status-error bg-status-error/5 border border-status-error/20 rounded-md px-3 py-2">
                <Icon name="error" size={14} className="shrink-0 mt-0.5" />
                <div>{error}</div>
              </div>
            )}

            <div className="flex justify-between gap-2">
              <Button
                variant="outline"
                onClick={() => setStep("select")}
                disabled={verifying}
                className="flex-1"
              >
                <Icon name="arrow_back" size={14} className="mr-1" />
                Chọn lại
              </Button>
              <Button
                onClick={handleVerify}
                disabled={!pinReady || verifying}
                className="flex-1"
              >
                {verifying ? (
                  <>
                    <Icon name="progress_activity" size={14} className="mr-1 animate-spin" />
                    Đang xác nhận...
                  </>
                ) : (
                  <>
                    <Icon name="login" size={14} className="mr-1" />
                    Vào ca
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
