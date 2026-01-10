import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export const roleLabels: Record<string, { label: string; class: string }> = {
    admin: { label: "Admin", class: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
    branch_manager: { label: "Quản lý", class: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
    accountant: { label: "Kế toán", class: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
    member: { label: "Nhân viên", class: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300" },
};
