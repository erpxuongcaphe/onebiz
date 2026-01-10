"use client";

import { Toaster } from 'sonner';

export function ToastProvider() {
    return (
        <Toaster
            position="top-right"
            expand={true}
            richColors
            closeButton
            toastOptions={{
                style: {
                    background: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    fontSize: '14px',
                    padding: '16px',
                },
                className: 'toast-custom',
                duration: 4000,
            }}
        />
    );
}
