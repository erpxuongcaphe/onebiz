"use client";

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Building2, Check, Globe } from 'lucide-react';
import { useBranch, ALL_BRANCHES_ID } from '@/contexts/BranchContext';
import { useAuth } from '@/contexts/AuthContext';

interface BranchSelectorProps {
    compact?: boolean;
}

export function BranchSelector({ compact = false }: BranchSelectorProps) {
    const { currentBranch, branches, switchBranch, isAllBranchesSelected } = useBranch();
    const { user } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Check if user can view all branches
    const canViewAllBranches = user && ['admin', 'accountant', 'branch_manager'].includes(user.role);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    if (!currentBranch) {
        return (
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-700/50 rounded-lg animate-pulse">
                <div className="w-5 h-5 bg-slate-600 rounded" />
                <div className="w-24 h-4 bg-slate-600 rounded" />
            </div>
        );
    }

    // Determine display info
    const displayName = isAllBranchesSelected ? 'Tất cả chi nhánh' : currentBranch.name;
    const DisplayIcon = isAllBranchesSelected ? Globe : Building2;

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full flex items-center gap-2 px-3 py-2.5 bg-slate-700/50 hover:bg-slate-700 rounded-lg transition-colors ${compact ? 'text-xs' : 'text-sm'
                    }`}
                title="Chọn chi nhánh"
            >
                <DisplayIcon
                    size={compact ? 16 : 18}
                    className={isAllBranchesSelected ? 'text-cyan-400 flex-shrink-0' : 'text-blue-400 flex-shrink-0'}
                />
                {!compact && (
                    <>
                        <span className="font-medium text-white truncate flex-1 text-left">
                            {displayName}
                        </span>
                        <ChevronDown
                            size={16}
                            className={`text-slate-400 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`}
                        />
                    </>
                )}
            </button>

            {isOpen && (
                <div className="absolute left-0 top-full mt-2 w-64 bg-slate-800 border border-slate-700 rounded-xl shadow-xl py-2 z-50">
                    <div className="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        Chọn chi nhánh
                    </div>

                    {/* All Branches option - only for directors/managers */}
                    {canViewAllBranches && (
                        <>
                            <button
                                onClick={() => {
                                    switchBranch(ALL_BRANCHES_ID);
                                    setIsOpen(false);
                                }}
                                className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-700 transition-colors ${isAllBranchesSelected ? 'bg-cyan-900/30' : ''
                                    }`}
                            >
                                <Globe
                                    size={18}
                                    className={isAllBranchesSelected ? 'text-cyan-400' : 'text-slate-400'}
                                />
                                <div className="flex-1 text-left">
                                    <div className={`text-sm font-medium ${isAllBranchesSelected
                                            ? 'text-cyan-400'
                                            : 'text-slate-200'
                                        }`}>
                                        Tất cả chi nhánh
                                    </div>
                                    <div className="text-xs text-slate-400">
                                        Xem tổng hợp toàn hệ thống
                                    </div>
                                </div>
                                {isAllBranchesSelected && (
                                    <Check size={16} className="text-cyan-400 flex-shrink-0" />
                                )}
                            </button>
                            <div className="border-t border-slate-700 my-2" />
                        </>
                    )}

                    {/* Individual branches */}
                    <div className="max-h-64 overflow-y-auto">
                        {branches.map((branch) => (
                            <button
                                key={branch.id}
                                onClick={() => {
                                    switchBranch(branch.id);
                                    setIsOpen(false);
                                }}
                                className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-700 transition-colors ${!isAllBranchesSelected && currentBranch.id === branch.id ? 'bg-blue-900/30' : ''
                                    }`}
                            >
                                <Building2
                                    size={18}
                                    className={!isAllBranchesSelected && currentBranch.id === branch.id ? 'text-blue-400' : 'text-slate-400'}
                                />
                                <div className="flex-1 text-left">
                                    <div className={`text-sm font-medium ${!isAllBranchesSelected && currentBranch.id === branch.id
                                            ? 'text-blue-400'
                                            : 'text-slate-200'
                                        }`}>
                                        {branch.name}
                                    </div>
                                    {branch.address && (
                                        <div className="text-xs text-slate-400 truncate">
                                            {branch.address}
                                        </div>
                                    )}
                                </div>
                                {!isAllBranchesSelected && currentBranch.id === branch.id && (
                                    <Check size={16} className="text-blue-400 flex-shrink-0" />
                                )}
                                {branch.is_headquarters && (
                                    <span className="text-[10px] px-1.5 py-0.5 bg-amber-900/40 text-amber-400 rounded font-medium">
                                        HQ
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
