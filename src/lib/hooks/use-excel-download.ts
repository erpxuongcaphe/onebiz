"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useExcelDownload(scope: string) {
  const [file, setFile] = useState<{
    url: string;
    name: string;
    scope: string;
  } | null>(null);
  const [renderedScope, setRenderedScope] = useState(scope);
  if (renderedScope !== scope) {
    setRenderedScope(scope);
    setFile(null);
  }
  const url = useRef<string | null>(null);
  const mounted = useRef(false);
  const currentScope = useRef(scope);
  const clear = useCallback(() => {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    setFile(null);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = null;
    };
  }, []);
  useEffect(() => {
    currentScope.current = scope;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
  }, [scope]);
  const onPrepared = useCallback(
    (blob: Blob, name: string) => {
      // A late export must not appear under a different party or filter scope.
      if (!mounted.current || currentScope.current !== scope) return;
      clear();
      const next = URL.createObjectURL(blob);
      url.current = next;
      setFile({ url: next, name, scope });
    },
    [scope, clear],
  );
  return { file: file?.scope === scope ? file : null, clear, onPrepared };
}
