"use client";

import { useState, useEffect } from "react";
import { useBranch } from "@/contexts/BranchContext";
import { getProducts } from "@/lib/api/inventory";
import { Product } from "@/lib/types/inventory";
import { AlertTriangle, CheckCircle } from "lucide-react";
import Link from "next/link";

export default function StockAlertsPage() {
    const { currentBranch } = useBranch();
    const [lowStockProducts, setLowStockProducts] = useState<Product[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!currentBranch) return;
        const fetchLowStock = async () => {
            setIsLoading(true);
            try {
                // Fetch all active products and filter client side for now.
                // In real app, API should support filter=low_stock
                const allProducts = await getProducts(currentBranch.id);
                const lowStock = allProducts.filter(p => {
                    const stock = p.inventory?.stock_quantity || 0;
                    const min = p.min_stock_level || 0;
                    return stock <= min && p.is_active;
                });
                setLowStockProducts(lowStock);
            } catch (err) {
                console.error(err);
            } finally {
                setIsLoading(false);
            }
        };
        fetchLowStock();
    }, [currentBranch]);

    return (
        <div className="space-y-6 pb-20 animate-fade-in">
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex items-start gap-4">
                <div className="p-2 bg-amber-100 dark:bg-amber-900/40 rounded-lg">
                    <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-500" />
                </div>
                <div>
                    <h3 className="font-semibold text-slate-900 dark:text-white">Cảnh báo tồn kho thấp</h3>
                    <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                        Có {lowStockProducts.length} sản phẩm dưới định mức tồn tối thiểu cần được nhập thêm hàng.
                    </p>
                </div>
            </div>

            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-32 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse"></div>
                    ))}
                </div>
            ) : lowStockProducts.length === 0 ? (
                <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
                    <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                    <h3 className="text-lg font-medium text-slate-900 dark:text-white">Tồn kho ổn định</h3>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">Tất cả sản phẩm đều trên mức tối thiểu.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {lowStockProducts.map(product => (
                        <div key={product.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 hover:shadow-md transition-shadow">
                            <div className="flex justify-between items-start mb-4">
                                <div className="flex gap-3">
                                    <div className="w-12 h-12 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 flex-shrink-0 flex items-center justify-center overflow-hidden">
                                        {product.image_url && <img src={product.image_url} className="w-full h-full object-cover" alt={product.name} />}
                                    </div>
                                    <div>
                                        <h4 className="font-semibold text-slate-900 dark:text-white line-clamp-1">{product.name}</h4>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">{product.code}</p>
                                    </div>
                                </div>
                                <span className="px-2 py-1 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs font-bold rounded-full">
                                    Low Stock
                                </span>
                            </div>

                            <div className="space-y-3">
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-500 dark:text-slate-400">Hiện có</span>
                                    <span className="font-bold text-red-600 dark:text-red-400">{product.inventory?.stock_quantity || 0} {product.unit?.code}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-500 dark:text-slate-400">Định mức</span>
                                    <span className="font-medium text-slate-700 dark:text-slate-300">{product.min_stock_level} {product.unit?.code}</span>
                                </div>

                                <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                                    <div
                                        className="bg-red-500 h-full rounded-full"
                                        style={{ width: `${Math.min(100, ((product.inventory?.stock_quantity || 0) / (product.min_stock_level || 1)) * 100)}%` }}
                                    ></div>
                                </div>

                                <Link
                                    href="/dashboard/inventory/movements"
                                    className="block w-full py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-sm font-medium text-center rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors mt-2"
                                >
                                    Tạo phiếu nhập
                                </Link>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
