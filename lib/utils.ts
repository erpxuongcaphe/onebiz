import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

// User roles
export type UserRole = 'admin' | 'accountant' | 'branch_manager' | 'member';

// User type
export type User = {
    id: string;
    username: string;
    email: string;
    password: string; // In production, this would be hashed
    fullName: string;
    role: UserRole;
    employeeId: string | null; // Link to employee
    isActive: boolean;
    createdAt: string;
};

// Role labels in Vietnamese
export const roleLabels: Record<UserRole, { label: string; class: string; dot: string }> = {
    admin: { label: "Quản trị viên", class: "bg-purple-600 text-white ring-purple-400/50", dot: "bg-purple-300" },
    accountant: { label: "Kế toán", class: "bg-blue-600 text-white ring-blue-400/50", dot: "bg-blue-300" },
    branch_manager: { label: "Quản lý chi nhánh", class: "bg-amber-500 text-white ring-amber-400/50", dot: "bg-amber-300" },
    member: { label: "Thành viên", class: "bg-slate-600 text-white ring-slate-400/50", dot: "bg-slate-300" },
};

// Employee type (re-export for convenience)
export type Employee = {
    id: string;
    name: string;
    email: string;
    department: string;
    position: string;
    phone: string;
    status: "active" | "probation" | "inactive";
    joinDate: string;
    address: string;
    avatar: string;
};
