export type AppMode = 'main' | 'pos';

export function getAppMode(): AppMode {
  // Production: single Vercel build serves both onebiz.com.vn + pos.onebiz.com.vn
  // → detect from hostname at runtime
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname.startsWith('pos.')) return 'pos';
  }

  // Local dev fallback: use VITE_APP_MODE env var
  const raw = (import.meta.env.VITE_APP_MODE as string | undefined) ?? 'main';
  return raw === 'pos' ? 'pos' : 'main';
}
