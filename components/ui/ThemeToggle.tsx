"use client";

import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from '@/components/providers/ThemeProvider';
import { useState, useRef, useEffect } from 'react';

interface ThemeToggleProps {
    variant?: 'icon' | 'dropdown';
    size?: 'sm' | 'md';
}

export function ThemeToggle({ variant = 'icon', size = 'md' }: ThemeToggleProps) {
    const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

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

    const iconSize = size === 'sm' ? 16 : 20;
    const buttonClass = size === 'sm'
        ? 'p-1.5 rounded-lg'
        : 'p-2 rounded-xl';

    // Simple icon toggle
    if (variant === 'icon') {
        return (
            <button
                onClick={toggleTheme}
                className={`${buttonClass} bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors`}
                title={resolvedTheme === 'dark' ? 'Chuyển sang sáng' : 'Chuyển sang tối'}
                aria-label="Toggle theme"
            >
                {resolvedTheme === 'dark' ? (
                    <Sun size={iconSize} className="text-amber-500" />
                ) : (
                    <Moon size={iconSize} className="text-slate-600" />
                )}
            </button>
        );
    }

    // Dropdown with options
    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`${buttonClass} bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors`}
                title="Chế độ hiển thị"
                aria-label="Theme options"
            >
                {resolvedTheme === 'dark' ? (
                    <Moon size={iconSize} className="text-blue-400" />
                ) : (
                    <Sun size={iconSize} className="text-amber-500" />
                )}
            </button>

            {isOpen && (
                <div className="absolute right-0 top-full mt-2 w-36 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg py-1 z-50">
                    <button
                        onClick={() => { setTheme('light'); setIsOpen(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${theme === 'light' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'
                            }`}
                    >
                        <Sun size={16} />
                        <span>Sáng</span>
                        {theme === 'light' && <span className="ml-auto text-blue-600">✓</span>}
                    </button>
                    <button
                        onClick={() => { setTheme('dark'); setIsOpen(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${theme === 'dark' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'
                            }`}
                    >
                        <Moon size={16} />
                        <span>Tối</span>
                        {theme === 'dark' && <span className="ml-auto text-blue-400">✓</span>}
                    </button>
                    <button
                        onClick={() => { setTheme('system'); setIsOpen(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${theme === 'system' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'
                            }`}
                    >
                        <Monitor size={16} />
                        <span>Hệ thống</span>
                        {theme === 'system' && <span className="ml-auto text-blue-400">✓</span>}
                    </button>
                </div>
            )}
        </div>
    );
}
