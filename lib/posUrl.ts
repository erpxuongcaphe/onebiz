import type { TenantInfo } from './tenant';

export function getPosBaseUrl(params: { tenant: TenantInfo | null; hostname: string }): string {
  const envUrl = import.meta.env.VITE_POS_URL as string | undefined;
  if (envUrl && envUrl.trim()) return envUrl.trim();

  const host = (params.hostname || '').trim().toLowerCase();

  // Local dev default
  if (host === 'localhost' || host.startsWith('localhost:') || host === '127.0.0.1') {
    return 'http://localhost:3001';
  }

  // Already on pos subdomain → return current origin
  if (host.startsWith('pos.')) return `https://${host}`;

  // Main domain → prepend pos. subdomain
  return `https://pos.${host}`;
}

export function getMainDashboardUrl(hostname: string): string {
  const host = (hostname || '').trim().toLowerCase();

  // Local dev
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
    // Should imply we are on port 3001 if we are calling this from POS
    // So target 3000 for main
    return 'http://localhost:3000/dashboard';
  }

  // Production
  // If we are on pos.onebiz.com.vn -> onebiz.com.vn
  if (host.startsWith('pos.')) {
    return `https://${host.substring(4)}/dashboard`;
  }

  // custom domain or already main
  return '/dashboard';
}
