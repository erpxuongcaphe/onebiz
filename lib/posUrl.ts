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
