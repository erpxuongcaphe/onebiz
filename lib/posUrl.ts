import type { TenantInfo } from './tenant';

function stripFirstLabel(host: string): string {
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  return parts.slice(1).join('.');
}

export function getPosBaseUrl(params: { tenant: TenantInfo | null; hostname: string }): string {
  const envUrl = import.meta.env.VITE_POS_URL as string | undefined;
  if (envUrl && envUrl.trim()) return envUrl.trim();

  const host = (params.hostname || '').trim().toLowerCase();

  // Local dev default
  if (host === 'localhost' || host.startsWith('localhost:') || host === '127.0.0.1') {
    return 'http://localhost:3001';
  }

  const base = stripFirstLabel(host);
  return `https://pos.${base}`;
}
