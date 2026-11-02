"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PreparedFile = { url: string; filename: string; scope: string };

export function useScopedFileDownload(scope: string) {
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [prepared, setPrepared] = useState<PreparedFile | null>(null);

  useEffect(() => () => {
    if (prepared) URL.revokeObjectURL(prepared.url);
  }, [prepared]);
  useEffect(() => {
    currentScope.current = scope;
    return () => { currentScope.current = ""; };
  }, [scope]);

  const isCurrent = useCallback((expected: string) => currentScope.current === expected, []);
  const prepare = useCallback((blob: Blob, filename: string, expected: string) => {
    if (currentScope.current !== expected) return;
    setPrepared({ url: URL.createObjectURL(blob), filename, scope: expected });
  }, []);

  return { file: prepared?.scope === scope ? prepared : null, prepare, isCurrent };
}
