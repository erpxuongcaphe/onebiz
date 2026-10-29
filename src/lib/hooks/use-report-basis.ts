"use client";

import { useCallback, useEffect, useState } from "react";

export function useReportBasis() {
  const [excludeInternal, setValue] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const restore = () => {
      setValue(new URLSearchParams(window.location.search).get("basis") === "external");
      setReady(true);
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const setExcludeInternal = useCallback((value: boolean) => {
    const url = new URL(window.location.href);
    url.searchParams.set("basis", value ? "external" : "all");
    window.history.replaceState(window.history.state, "", url);
    setValue(value);
  }, []);
  return { excludeInternal, setExcludeInternal, ready, basisLabel: excludeInternal ? "Loại nội bộ" : "Gồm nội bộ" };
}
