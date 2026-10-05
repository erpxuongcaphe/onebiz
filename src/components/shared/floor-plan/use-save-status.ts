"use client";

import { useCallback, useRef, useState } from "react";

/** A batch is saved only after every outstanding write completes. */
export function useSaveStatus() {
  const pending = useRef(0);
  const failed = useRef(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const trackSave = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    if (pending.current === 0) failed.current = false;
    pending.current += 1;
    setSaveStatus("saving");
    try {
      return await operation();
    } catch (error) {
      failed.current = true;
      throw error;
    } finally {
      pending.current -= 1;
      if (pending.current === 0) setSaveStatus(failed.current ? "error" : "saved");
    }
  }, []);
  return { saveStatus, trackSave };
}
