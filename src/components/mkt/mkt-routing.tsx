"use client";

import {
  createContext,
  useCallback,
  useContext,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";
import Link, { type LinkProps } from "next/link";
import { resolveMktHref, type MktBasePath } from "@/lib/mkt/routing";

const MktBasePathContext = createContext<MktBasePath>("/mkt");

export function MktRoutingProvider({
  basePath,
  children,
}: {
  basePath: MktBasePath;
  children: ReactNode;
}) {
  return <MktBasePathContext.Provider value={basePath}>{children}</MktBasePathContext.Provider>;
}

export function useMktHref() {
  const basePath = useContext(MktBasePathContext);
  return useCallback((href: string) => resolveMktHref(href, basePath), [basePath]);
}

type MktLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps | "href">;

export function MktLink({ href, ...props }: MktLinkProps) {
  const toMktHref = useMktHref();
  const resolvedHref = typeof href === "string" ? toMktHref(href) : href;
  return <Link href={resolvedHref} {...props} />;
}
