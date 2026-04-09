"use client";

import { useEffect, useState } from "react";

/**
 * Return a debounced copy of `value` that only updates after `delay` ms
 * of no change. Used for search inputs to avoid over-fetching.
 */
export function useDebounce<T>(value: T, delay: number = 200): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}
