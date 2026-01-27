import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { resolveTenantByHostname, type TenantInfo } from './tenant';

type TenantContextValue = {
  tenant: TenantInfo | null;
  loading: boolean;
};

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

function applyBranding(tenant: TenantInfo | null) {
  const root = document.documentElement;
  const primary = tenant?.primary_color || '#4F46E5';
  root.style.setProperty('--onebiz-primary', primary);
  document.title = tenant?.name ? `${tenant.name} ERP` : 'OneBiz ERP';
}

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const hostname = window.location.hostname;

    (async () => {
      const t = await resolveTenantByHostname(hostname);
      if (t) return t;

      // Local dev fallback
      return await resolveTenantByHostname('onebiz.com.vn');
    })()
      .then((t) => {
        if (!isMounted) return;
        setTenant(t);
        applyBranding(t);
        if (t?.id) {
          try {
            localStorage.setItem('onebiz.tenant_id', t.id);
          } catch {
            // ignore
          }
        }
      })
      .finally(() => {
        if (!isMounted) return;
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const value = useMemo(() => ({ tenant, loading }), [tenant, loading]);

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error('useTenant must be used within TenantProvider');
  return ctx;
}

export function getCachedTenantId(): string | null {
  try {
    return localStorage.getItem('onebiz.tenant_id');
  } catch {
    return null;
  }
}
