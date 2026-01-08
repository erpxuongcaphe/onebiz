"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AnimatedCardProps {
    children: ReactNode;
    className?: string;
    delay?: number;
    hover?: boolean;
}

export function AnimatedCard({
    children,
    className,
    delay = 0,
    hover = true,
}: AnimatedCardProps) {
    return (
        <div
            className={cn(
                "bg-white rounded-xl border border-slate-200 shadow-sm opacity-0 animate-slide-up",
                hover && "hover-lift cursor-pointer",
                className
            )}
            style={{ animationDelay: `${delay}ms`, animationFillMode: "forwards" }}
        >
            {children}
        </div>
    );
}

interface StatCardProps {
    title: string;
    value: string | number;
    icon: ReactNode;
    change?: string;
    changeType?: "positive" | "negative" | "neutral";
    subtext?: string;
    delay?: number;
    iconColor?: string;
}

export function StatCard({
    title,
    value,
    icon,
    change,
    changeType = "neutral",
    subtext,
    delay = 0,
    iconColor = "bg-blue-50 text-blue-600",
}: StatCardProps) {
    const changeColors = {
        positive: "bg-green-50 text-green-700",
        negative: "bg-red-50 text-red-700",
        neutral: "bg-slate-100 text-slate-600",
    };

    return (
        <AnimatedCard delay={delay} className="p-6">
            <div className="flex items-center justify-between mb-4">
                <div className={cn("p-2.5 rounded-lg transition-transform duration-200 hover:scale-110", iconColor)}>
                    {icon}
                </div>
                {change && (
                    <span
                        className={cn(
                            "text-xs font-medium px-2 py-1 rounded-full",
                            changeColors[changeType]
                        )}
                    >
                        {change}
                    </span>
                )}
            </div>
            <h3 className="text-sm font-medium text-slate-500">{title}</h3>
            <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
            {subtext && <p className="text-xs text-slate-400 mt-1">{subtext}</p>}
        </AnimatedCard>
    );
}
