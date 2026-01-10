"use client";

import { useState } from "react";
import { ChevronDown, X, Filter } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FilterOption {
    value: string;
    label: string;
}

export interface FilterConfig {
    key: string;
    label: string;
    options: FilterOption[];
    placeholder?: string;
}

interface FilterBarProps {
    filters: FilterConfig[];
    values: Record<string, string>;
    onChange: (key: string, value: string) => void;
    onReset?: () => void;
}

export function FilterBar({ filters, values, onChange, onReset }: FilterBarProps) {
    const [openDropdown, setOpenDropdown] = useState<string | null>(null);

    const activeFilters = Object.entries(values).filter(([, v]) => v);

    return (
        <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400">
                <Filter className="w-4 h-4" />
                <span className="hidden sm:inline font-medium">Lọc:</span>
            </div>

            {filters.map(filter => (
                <div key={filter.key} className="relative">
                    <button
                        onClick={() => setOpenDropdown(openDropdown === filter.key ? null : filter.key)}
                        className={cn(
                            "inline-flex items-center gap-2 px-3 py-2 text-sm rounded-xl border transition-all",
                            values[filter.key]
                                ? "bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300"
                                : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600"
                        )}
                    >
                        <span className="max-w-[100px] truncate">
                            {values[filter.key]
                                ? filter.options.find(o => o.value === values[filter.key])?.label
                                : filter.placeholder || filter.label}
                        </span>
                        <ChevronDown className={cn(
                            "w-4 h-4 transition-transform",
                            openDropdown === filter.key && "rotate-180"
                        )} />
                    </button>

                    {openDropdown === filter.key && (
                        <>
                            <div
                                className="fixed inset-0 z-40"
                                onClick={() => setOpenDropdown(null)}
                            />
                            <div className="absolute left-0 top-full mt-1 z-50 w-48 p-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg max-h-64 overflow-y-auto">
                                <button
                                    onClick={() => {
                                        onChange(filter.key, '');
                                        setOpenDropdown(null);
                                    }}
                                    className={cn(
                                        "w-full text-left px-3 py-2 text-sm rounded-lg transition-all",
                                        !values[filter.key]
                                            ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                                            : "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                                    )}
                                >
                                    Tất cả
                                </button>
                                {filter.options.map(option => (
                                    <button
                                        key={option.value}
                                        onClick={() => {
                                            onChange(filter.key, option.value);
                                            setOpenDropdown(null);
                                        }}
                                        className={cn(
                                            "w-full text-left px-3 py-2 text-sm rounded-lg transition-all",
                                            values[filter.key] === option.value
                                                ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                                                : "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                                        )}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            ))}

            {activeFilters.length > 0 && onReset && (
                <button
                    onClick={onReset}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all"
                >
                    <X className="w-3.5 h-3.5" />
                    Xóa lọc
                </button>
            )}
        </div>
    );
}

export default FilterBar;
