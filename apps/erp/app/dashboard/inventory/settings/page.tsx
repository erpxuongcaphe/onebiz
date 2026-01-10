"use client";

import { useState, useEffect } from "react";
import { getCategories, getUnits } from "@/lib/api/inventory";
import { Category, Unit } from "@/lib/types/inventory";
import { Tag, Scale } from "lucide-react";

export default function InventorySettingsPage() {
    const [categories, setCategories] = useState<Category[]>([]);
    const [units, setUnits] = useState<Unit[]>([]);

    useEffect(() => {
        Promise.all([getCategories(), getUnits()]).then(([c, u]) => {
            setCategories(c);
            setUnits(u);
        });
    }, []);

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-fade-in">
            {/* Categories Section */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 h-fit">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                        <Tag className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">Danh mục sản phẩm</h2>
                </div>

                <div className="space-y-2">
                    {categories.map(cat => (
                        <div key={cat.id} className="flex justify-between items-center p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg border border-transparent hover:border-slate-100 dark:hover:border-slate-700 transition-all">
                            <div>
                                <div className="font-medium text-slate-900 dark:text-white">{cat.name}</div>
                                {cat.description && <div className="text-xs text-slate-500 dark:text-slate-400">{cat.description}</div>}
                            </div>
                            <span className="px-2 py-1 bg-slate-100 dark:bg-slate-800 text-xs text-slate-500 dark:text-slate-400 rounded">
                                {cat.is_active ? 'Active' : 'Inactive'}
                            </span>
                        </div>
                    ))}
                    {categories.length === 0 && <p className="text-slate-500 text-sm">Chưa có danh mục nào.</p>}
                </div>

                <button className="w-full mt-4 py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors border border-dashed border-blue-200 dark:border-blue-800">
                    + Thêm danh mục mới
                </button>
            </div>

            {/* Units Section */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 h-fit">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                        <Scale className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">Đơn vị tính</h2>
                </div>

                <div className="space-y-2">
                    {units.map(unit => (
                        <div key={unit.id} className="flex justify-between items-center p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg border border-transparent hover:border-slate-100 dark:hover:border-slate-700 transition-all">
                            <div>
                                <div className="font-medium text-slate-900 dark:text-white">{unit.name}</div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">Mã: {unit.code}</div>
                            </div>
                            <span className="px-2 py-1 bg-slate-100 dark:bg-slate-800 text-xs text-slate-500 dark:text-slate-400 rounded">
                                {unit.is_active ? 'Active' : 'Inactive'}
                            </span>
                        </div>
                    ))}
                    {units.length === 0 && <p className="text-slate-500 text-sm">Chưa có đơn vị tính nào.</p>}
                </div>

                <button className="w-full mt-4 py-2 text-sm text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-lg transition-colors border border-dashed border-purple-200 dark:border-purple-800">
                    + Thêm đơn vị mới
                </button>
            </div>
        </div>
    );
}
