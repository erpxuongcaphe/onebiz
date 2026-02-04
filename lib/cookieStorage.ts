import Cookies from 'js-cookie';

const COOKIE_DOMAIN = '.onebiz.com.vn';

// Check if we are running on the production domain (or subdomain)
const isProduction = typeof window !== 'undefined' && window.location.hostname.includes('onebiz.com.vn');

/**
 * Custom storage adapter for Supabase to use Cookies instead of LocalStorage.
 * This enables session sharing across subdomains (onebiz.com.vn <-> pos.onebiz.com.vn).
 */
export const cookieStorage = {
    getItem: (key: string): string | null => {
        return Cookies.get(key) ?? null;
    },
    setItem: (key: string, value: string): void => {
        Cookies.set(key, value, {
            domain: isProduction ? COOKIE_DOMAIN : undefined, // cookie shareable across subdomains
            path: '/',
            secure: isProduction, // Secure only in prod (https)
            sameSite: 'Lax',
            expires: 365, // 1 year
        });
    },
    removeItem: (key: string): void => {
        Cookies.remove(key, {
            domain: isProduction ? COOKIE_DOMAIN : undefined,
            path: '/',
        });
    },
};
