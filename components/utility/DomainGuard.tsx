import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getAppMode } from '../../lib/appMode';

interface DomainGuardProps {
    children: React.ReactNode;
    allowedMode: 'main' | 'pos';
    redirectTo?: string;
}

/**
 * Guards routes to ensure they are only accessible on the correct domain/appMode.
 * 
 * Example:
 * - Admin routes should only be accessible when appMode === 'main'
 * - POS routes should only be accessible when appMode === 'pos' (or explicitly handled)
 */
const DomainGuard: React.FC<DomainGuardProps> = ({ children, allowedMode, redirectTo }) => {
    const appMode = getAppMode();
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        if (appMode !== allowedMode) {
            // If we are in POS mode but trying to access Main routes -> Redirect to POS
            if (appMode === 'pos') {
                window.location.href = '/pos'; // Hard redirect to ensure clean state
            }
            // If we are in Main mode but trying to access POS routes -> Redirect to Dashboard
            else if (appMode === 'main') {
                // Optional: Redirect to POS subdomain if we want to enforce it
                // For now, let's keep it simple within the app routing or use the passed redirectTo
                if (redirectTo) {
                    navigate(redirectTo, { replace: true });
                } else {
                    navigate('/dashboard', { replace: true });
                }
            }
        }
    }, [appMode, allowedMode, navigate, redirectTo]);

    if (appMode !== allowedMode) {
        return null; // Or a loading spinner while redirecting
    }

    return <>{children}</>;
};

export default DomainGuard;
