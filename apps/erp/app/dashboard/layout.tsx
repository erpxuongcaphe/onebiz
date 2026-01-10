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
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 relative overflow-hidden font-sans selection:bg-blue-500/30">
            {/* Global Animated Background */}
            <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
                <div className="absolute top-[-20%] left-[-10%] w-[50vw] h-[50vw] bg-blue-500/5 dark:bg-blue-500/10 rounded-full blur-[120px] animate-pulse-subtle" />
                <div className="absolute bottom-[-20%] right-[-10%] w-[50vw] h-[50vw] bg-purple-500/5 dark:bg-purple-500/10 rounded-full blur-[120px] animate-pulse-subtle stagger-2" />
                <div className="absolute top-[30%] right-[20%] w-[30vw] h-[30vw] bg-cyan-500/5 dark:bg-cyan-500/5 rounded-full blur-[100px] animate-float" />
            </div>

            <ToastProvider />

            {/* Sidebar wrapper with higher z-index */}
            <div className="relative z-40">
                <Sidebar />
            </div>

            <main className="relative z-10 md:pl-72 min-h-screen transition-all duration-300">
                <div className="container mx-auto p-4 md:p-8 pb-32 md:pb-10 max-w-7xl animate-fade-in">
                    {children}
                </div>
            </main>

            <div className="relative z-50">
                <MobileBottomNav />
            </div>
        </div>
    );

}
