import { useState, useEffect } from 'react';

/**
 * React hook to detect online/offline network status
 *
 * Uses navigator.onLine and window online/offline events
 * to track network connectivity in real-time.
 *
 * @returns boolean - true if online, false if offline
 *
 * @example
 * const isOnline = useOnlineStatus();
 * if (!isOnline) {
 *   // Save data offline
 * }
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
