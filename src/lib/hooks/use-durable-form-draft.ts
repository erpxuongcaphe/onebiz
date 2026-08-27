"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentContext } from "@/lib/services/supabase/base";

const STORAGE_PREFIX = "onebiz_form_draft_v1";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const SAVE_DELAY_MS = 250;

interface DraftScope {
  tenantId: string;
  userId: string;
  branchId: string;
}

interface StoredFormDraft<T> extends DraftScope {
  version: 1;
  form: string;
  entityId: string | null;
  updatedAt: number;
  expiresAt: number;
  data: T;
}

export interface RecoverableFormDraft<T> {
  entityId: string | null;
  updatedAt: number;
  data: T;
}

const activeWork = new Set<string>();

export function hasActiveFormWork(): boolean {
  return activeWork.size > 0;
}

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function storageKey(
  form: string,
  scope: DraftScope,
  entityId: string | null,
): string {
  return [
    STORAGE_PREFIX,
    scope.tenantId,
    scope.userId,
    scope.branchId,
    form,
    entityId ?? "new",
  ].join(":");
}

function storagePrefix(): string {
  return `${STORAGE_PREFIX}:`;
}

async function resolveScope(branchId?: string | null): Promise<DraftScope> {
  const context = await getCurrentContext();
  return {
    tenantId: context.tenantId,
    userId: context.userId,
    branchId: branchId ?? context.branchId,
  };
}

function parseDraft<T>(raw: string | null): StoredFormDraft<T> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredFormDraft<T>;
    if (
      parsed.version !== 1 ||
      !parsed.form ||
      !parsed.tenantId ||
      !parsed.userId ||
      !parsed.branchId ||
      !parsed.updatedAt ||
      !parsed.expiresAt
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function readDraft<T>(key: string): StoredFormDraft<T> | null {
  const storage = safeStorage();
  if (!storage) return null;
  const draft = parseDraft<T>(storage.getItem(key));
  if (!draft) return null;
  if (draft.expiresAt <= Date.now()) {
    storage.removeItem(key);
    return null;
  }
  return draft;
}

export async function findLatestFormDraft<T>(
  form: string,
  options: { branchId?: string | null; entityId?: string | null } = {},
): Promise<RecoverableFormDraft<T> | null> {
  const storage = safeStorage();
  if (!storage) return null;
  const scope = await resolveScope(options.branchId);
  let latest: StoredFormDraft<T> | null = null;

  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (!key?.startsWith(storagePrefix())) continue;
    const draft = parseDraft<T>(storage.getItem(key));
    if (!draft) continue;
    if (draft.expiresAt <= Date.now()) {
      storage.removeItem(key);
      continue;
    }
    if (
      draft.form !== form ||
      draft.tenantId !== scope.tenantId ||
      draft.userId !== scope.userId ||
      draft.branchId !== scope.branchId ||
      (options.entityId !== undefined &&
        draft.entityId !== options.entityId)
    ) {
      continue;
    }
    if (!latest || draft.updatedAt > latest.updatedAt) latest = draft;
  }

  return latest
    ? {
        entityId: latest.entityId,
        updatedAt: latest.updatedAt,
        data: latest.data,
      }
    : null;
}

interface UseDurableFormDraftOptions<T> {
  form: string;
  open: boolean;
  branchId?: string | null;
  entityId?: string | null;
  snapshot: T;
  hasContent: (snapshot: T) => boolean;
  restore: (snapshot: T) => void;
  onRequestOpen?: () => void;
  autoRestore?: boolean;
  /** For edit forms, do not create a draft until the loaded snapshot changes. */
  saveOnlyWhenChanged?: boolean;
  /** Delay applying a recovered snapshot until async form initialization is done. */
  ready?: boolean;
  ttlMs?: number;
}

export function useDurableFormDraft<T>({
  form,
  open,
  branchId,
  entityId = null,
  snapshot,
  hasContent,
  restore,
  onRequestOpen,
  autoRestore = true,
  saveOnlyWhenChanged = false,
  ready = true,
  ttlMs = DEFAULT_TTL_MS,
}: UseDurableFormDraftOptions<T>) {
  const tokenRef = useRef(
    `${form}:${Math.random().toString(36).slice(2)}:${Date.now()}`,
  );
  const [key, setKey] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [restored, setRestored] = useState(false);
  const pendingDraftRef = useRef<T | null>(null);
  const baselineRef = useRef<string | null>(null);
  const scopeRef = useRef<DraftScope | null>(null);
  const snapshotRef = useRef(snapshot);
  const restoreRef = useRef(restore);
  const hasContentRef = useRef(hasContent);
  const requestOpenRef = useRef(onRequestOpen);
  const openRef = useRef(open);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  snapshotRef.current = snapshot;
  restoreRef.current = restore;
  hasContentRef.current = hasContent;
  requestOpenRef.current = onRequestOpen;
  openRef.current = open;

  useEffect(() => {
    let cancelled = false;
    setKey(null);
    setLoaded(false);
    setRestored(false);
    pendingDraftRef.current = null;
    baselineRef.current = null;
    scopeRef.current = null;

    resolveScope(branchId)
      .then((scope) => {
        if (cancelled) return;
        scopeRef.current = scope;
        const nextKey = storageKey(form, scope, entityId);
        const existing = readDraft<T>(nextKey);
        pendingDraftRef.current = existing?.data ?? null;
        setKey(nextKey);
        setLoaded(true);
        if (existing && autoRestore && !openRef.current) {
          requestOpenRef.current?.();
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [autoRestore, branchId, entityId, form]);

  useEffect(() => {
    if (!open || !loaded || restored || !ready) return;
    if (pendingDraftRef.current) {
      restoreRef.current(pendingDraftRef.current);
    } else if (saveOnlyWhenChanged) {
      baselineRef.current = JSON.stringify(snapshotRef.current);
    }
    setRestored(true);
  }, [loaded, open, ready, restored, saveOnlyWhenChanged]);

  useEffect(() => {
    if (open || !key || !loaded) return;
    pendingDraftRef.current = readDraft<T>(key)?.data ?? null;
    setRestored(false);
  }, [key, loaded, open]);

  const writeNow = useCallback(() => {
    if (!key || !open || !restored) return;
    const storage = safeStorage();
    if (!storage) return;
    const current = snapshotRef.current;
    if (
      saveOnlyWhenChanged &&
      baselineRef.current !== null &&
      JSON.stringify(current) === baselineRef.current
    ) {
      storage.removeItem(key);
      return;
    }
    if (!hasContentRef.current(current)) {
      storage.removeItem(key);
      return;
    }
    const scope = scopeRef.current;
    if (!scope) return;
    const now = Date.now();
    const envelope: StoredFormDraft<T> = {
      version: 1,
      ...scope,
      form,
      entityId,
      updatedAt: now,
      expiresAt: now + ttlMs,
      data: current,
    };
    try {
      storage.setItem(key, JSON.stringify(envelope));
    } catch {
      // Quota/private mode: the form remains usable; unload warning still works.
    }
  }, [entityId, form, key, open, restored, saveOnlyWhenChanged, ttlMs]);

  useEffect(() => {
    if (!open || !restored) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(writeNow, SAVE_DELAY_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [open, restored, snapshot, writeNow]);

  const meaningful = open && hasContent(snapshot);
  useEffect(() => {
    const token = tokenRef.current;
    if (open) activeWork.add(token);
    else activeWork.delete(token);
    return () => {
      activeWork.delete(token);
    };
  }, [open]);

  useEffect(() => {
    if (!meaningful) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") writeNow();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      writeNow();
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [meaningful, writeNow]);

  const clearDraft = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (key) safeStorage()?.removeItem(key);
    pendingDraftRef.current = null;
    setRestored(true);
  }, [key]);

  return { clearDraft, restored };
}
