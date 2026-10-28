"use client";

import { useCallback, useEffect, useState } from "react";
import { PosPinStatusError, readMyPinStatus } from "@/components/shared/my-pos-pin";

type PinState = { userId: string; hasPin?: boolean; error?: string };
const RETRY_DELAYS = [1500, 4000, 10000];
const NETWORK_MESSAGE = "Chưa kết nối được máy chủ để kiểm tra phiên. Hãy kiểm tra kết nối mạng rồi thử lại. Đơn đang mở được giữ nguyên.";

export function usePosPinStatus(needsCheck: boolean, userId: string | undefined) {
  const [state, setState] = useState<PinState | null>(null);
  const [revision, setRevision] = useState(0);
  const check = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    if (!needsCheck || !userId) return;
    let active = true;
    let running = false;
    let retries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const load = async () => {
      if (!active || running) return;
      clearTimeout(retryTimer);
      running = true;
      controller = new AbortController();
      let timedOut = false;
      timeout = setTimeout(() => { timedOut = true; controller?.abort(); }, 12000);
      try {
        const status = await readMyPinStatus(controller.signal);
        if (!active) return;
        if (status.userId !== userId) {
          setState({ userId, error: "Phiên tài khoản vừa thay đổi. Vui lòng đăng nhập lại." });
          return;
        }
        retries = 0;
        setState(status);
      } catch (error) {
        if (!active) return;
        const transportFailure = timedOut || error instanceof TypeError || error instanceof PosPinStatusError && error.retryable;
        // A failed verification must not reuse a previous successful PIN check.
        setState({ userId, error: transportFailure ? NETWORK_MESSAGE : error instanceof Error ? error.message : "Chưa kiểm tra được PIN." });
        if (transportFailure && retries < RETRY_DELAYS.length) {
          retryTimer = setTimeout(() => { void load(); }, RETRY_DELAYS[retries++]);
        }
      } finally {
        clearTimeout(timeout);
        running = false;
      }
    };
    const reconnect = () => {
      if (running) return;
      retries = 0;
      void load();
    };
    const onVisible = () => { if (document.visibilityState === "visible") reconnect(); };
    void load();
    window.addEventListener("online", reconnect);
    window.addEventListener("onebiz:pin-updated", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      clearTimeout(retryTimer);
      clearTimeout(timeout);
      controller?.abort();
      window.removeEventListener("online", reconnect);
      window.removeEventListener("onebiz:pin-updated", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [needsCheck, userId, revision, check]);

  return { state, check };
}
