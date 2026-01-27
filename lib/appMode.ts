export type AppMode = 'main' | 'pos';

export function getAppMode(): AppMode {
  const raw = (import.meta.env.VITE_APP_MODE as string | undefined) ?? 'main';
  return raw === 'pos' ? 'pos' : 'main';
}
