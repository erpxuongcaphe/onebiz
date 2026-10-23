"use client";

import { useEffect } from "react";

/** Route lifetime includes body portals (dialogs, menus); no storage or branch setting. */
export function FnbLegacyColors() {
  useEffect(() => {
    const supports = window.CSS?.supports;
    if (supports?.("color", "oklch(1 0 0)") && supports?.("color", "color-mix(in oklab, black, transparent)")) return;
    const previous = document.body.getAttribute("data-fnb-legacy-colors");
    document.body.setAttribute("data-fnb-legacy-colors", "true");
    return () => {
      if (previous === null) document.body.removeAttribute("data-fnb-legacy-colors");
      else document.body.setAttribute("data-fnb-legacy-colors", previous);
    };
  }, []);
  return null;
}
