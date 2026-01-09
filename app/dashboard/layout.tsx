"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { ToastProvider } from "@/components/providers/ToastProvider";
import { useAuth } from "@/contexts/AuthContext";
import { runReminderChecks } from "@/lib/api/reminders";

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { user, isAuthenticated, isLoading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            router.push("/login");
        }
    }, [isAuthenticated, isLoading, router]);

    // Run reminder checks for managers/admins (auto-throttled to once per hour)
    useEffect(() => {
        if (user && user.role !== 'member') {
            runReminderChecks().then(result => {
                if (!result.skipped) {
                    console.log('Reminder check completed:', result);
                }
            }).catch(console.error);
        }
    }, [user]);

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
            </div>
        );
    }

    if (!isAuthenticated) {
        return null;
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
            <ToastProvider />
            <Sidebar />
            <main className="md:pl-72 min-h-screen transition-all duration-300">
                <div className="container mx-auto p-4 md:p-10 pb-24 md:pb-10 max-w-7xl">
                    {children}
                </div>
            </main>
            <MobileBottomNav />
        </div>
    );
}
