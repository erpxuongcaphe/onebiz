"use client";

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { User, authenticateUser } from "@/lib/api/users";
import { UserRole } from "@/lib/database.types";
import { getEffectivePermissions, PermissionCode } from "@/lib/api/user-permissions";

type AuthContextType = {
    user: User | null;
    permissions: string[];
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
    logout: () => void;
    hasPermission: (requiredRoles: UserRole[]) => boolean;
    hasSpecificPermission: (code: PermissionCode | string) => boolean;
    refreshPermissions: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [permissions, setPermissions] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Load permissions for a user
    const loadPermissions = useCallback(async (currentUser: User) => {
        try {
            const perms = await getEffectivePermissions(currentUser.id, currentUser.role);
            setPermissions(perms);
            // Cache permissions in localStorage
            localStorage.setItem("hrm_permissions", JSON.stringify(perms));
        } catch (error) {
            console.error("Failed to load permissions:", error);
            setPermissions([]);
        }
    }, []);

    // Check for existing session on mount
    useEffect(() => {
        const storedUser = localStorage.getItem("hrm_user");
        const storedPermissions = localStorage.getItem("hrm_permissions");

        if (storedUser) {
            try {
                const parsedUser = JSON.parse(storedUser);
                setUser(parsedUser);

                // Load cached permissions first, then refresh
                if (storedPermissions) {
                    setPermissions(JSON.parse(storedPermissions));
                }

                // Refresh permissions in background
                loadPermissions(parsedUser);
            } catch {
                localStorage.removeItem("hrm_user");
                localStorage.removeItem("hrm_permissions");
            }
        }
        setIsLoading(false);
    }, [loadPermissions]);

    const login = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
        try {
            const foundUser = await authenticateUser(username, password);

            if (foundUser) {
                setUser(foundUser);
                localStorage.setItem("hrm_user", JSON.stringify(foundUser));

                // Load permissions after login
                await loadPermissions(foundUser);

                return { success: true };
            }

            return { success: false, error: "Tên đăng nhập hoặc mật khẩu không đúng" };
        } catch (error) {
            console.error("Login error:", error);
            const errorMessage = error instanceof Error ? error.message : 'Lỗi kết nối không xác định';
            return { success: false, error: `Lỗi đăng nhập: ${errorMessage}` };
        }
    };

    const logout = () => {
        setUser(null);
        setPermissions([]);
        localStorage.removeItem("hrm_user");
        localStorage.removeItem("hrm_permissions");
    };

    // Check role-based permission (legacy)
    const hasPermission = (requiredRoles: UserRole[]): boolean => {
        if (!user) return false;
        return requiredRoles.includes(user.role);
    };

    // Check specific permission code (new granular system)
    const hasSpecificPermission = (code: PermissionCode | string): boolean => {
        if (!user) return false;
        // Admin always has all permissions
        if (user.role === 'admin') return true;
        return permissions.includes(code);
    };

    // Refresh permissions (e.g., after admin changes them)
    const refreshPermissions = async () => {
        if (user) {
            await loadPermissions(user);
        }
    };

    return (
        <AuthContext.Provider value={{
            user,
            permissions,
            isAuthenticated: !!user,
            isLoading,
            login,
            logout,
            hasPermission,
            hasSpecificPermission,
            refreshPermissions,
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}

// Re-export types for convenience
export type { User, UserRole };
