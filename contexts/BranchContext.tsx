"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { Branch } from '@/lib/types/branch';
import { getBranches, getDefaultBranch } from '@/lib/api/branches';
import { useAuth } from '@/contexts/AuthContext';

// Special constant for "All branches" selection
export const ALL_BRANCHES_ID = '__ALL_BRANCHES__';

// Virtual branch representing "All branches"
export const ALL_BRANCHES: Branch = {
    id: ALL_BRANCHES_ID,
    code: 'ALL',
    name: 'Tất cả chi nhánh',
    is_headquarters: false,
    is_warehouse: false,
    is_pos_enabled: false,
    is_active: true,
    settings: {},
    created_at: '',
    updated_at: '',
};

interface BranchContextType {
    currentBranch: Branch | null;
    branches: Branch[];
    isLoading: boolean;
    error: string | null;
    isAllBranchesSelected: boolean;  // Helper to check if viewing all branches
    switchBranch: (branchId: string) => void;
    selectAllBranches: () => void;  // New function for directors
    refreshBranches: () => Promise<void>;
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

const STORAGE_KEY = 'erp_current_branch_id';

export function BranchProvider({ children }: { children: ReactNode }) {
    const { user, isAuthenticated } = useAuth();
    const [currentBranch, setCurrentBranch] = useState<Branch | null>(null);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Check if user can view all branches (admin, accountant, branch_manager)
    const canViewAllBranches = user && ['admin', 'accountant', 'branch_manager'].includes(user.role);

    // Load branches when authenticated
    useEffect(() => {
        if (isAuthenticated && user) {
            loadBranches();
        }
    }, [isAuthenticated, user]);

    const loadBranches = async () => {
        try {
            setIsLoading(true);
            setError(null);

            // Load all active branches
            const branchList = await getBranches();
            setBranches(branchList);

            // Try to restore from localStorage
            const savedBranchId = localStorage.getItem(STORAGE_KEY);

            // Check if saved selection was "All branches"
            if (savedBranchId === ALL_BRANCHES_ID && canViewAllBranches) {
                setCurrentBranch(ALL_BRANCHES);
                setIsLoading(false);
                return;
            }

            if (savedBranchId) {
                const savedBranch = branchList.find(b => b.id === savedBranchId);
                if (savedBranch) {
                    setCurrentBranch(savedBranch);
                    setIsLoading(false);
                    return;
                }
            }

            // For admin/manager: default to "All branches"
            if (canViewAllBranches) {
                setCurrentBranch(ALL_BRANCHES);
                localStorage.setItem(STORAGE_KEY, ALL_BRANCHES_ID);
            } else if (user) {
                // Get default branch for regular user
                const defaultBranch = await getDefaultBranch(user.id);
                if (defaultBranch) {
                    setCurrentBranch(defaultBranch);
                    localStorage.setItem(STORAGE_KEY, defaultBranch.id);
                } else if (branchList.length > 0) {
                    // Fallback to first branch
                    setCurrentBranch(branchList[0]);
                    localStorage.setItem(STORAGE_KEY, branchList[0].id);
                }
            }
        } catch (err) {
            console.error('Error loading branches:', err);
            setError(err instanceof Error ? err.message : 'Lỗi tải chi nhánh');
        } finally {
            setIsLoading(false);
        }
    };

    const switchBranch = (branchId: string) => {
        if (branchId === ALL_BRANCHES_ID) {
            selectAllBranches();
            return;
        }

        const branch = branches.find(b => b.id === branchId);
        if (branch) {
            setCurrentBranch(branch);
            localStorage.setItem(STORAGE_KEY, branchId);
        }
    };

    const selectAllBranches = () => {
        if (canViewAllBranches) {
            setCurrentBranch(ALL_BRANCHES);
            localStorage.setItem(STORAGE_KEY, ALL_BRANCHES_ID);
        }
    };

    const refreshBranches = async () => {
        await loadBranches();
    };

    const isAllBranchesSelected = currentBranch?.id === ALL_BRANCHES_ID;

    return (
        <BranchContext.Provider value={{
            currentBranch,
            branches,
            isLoading,
            error,
            isAllBranchesSelected,
            switchBranch,
            selectAllBranches,
            refreshBranches
        }}>
            {children}
        </BranchContext.Provider>
    );
}

export function useBranch() {
    const context = useContext(BranchContext);
    if (context === undefined) {
        throw new Error('useBranch must be used within a BranchProvider');
    }
    return context;
}
