"use client";

import { useState, useEffect, useCallback } from "react";
import { useBranch } from "@/contexts/BranchContext";
import { getProducts, getCategories, deleteProduct } from "@/lib/api/inventory";
import { Product, Category } from "@/lib/types/inventory";
import { Plus, Search, Filter, Edit, Trash2, Package } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ProductForm } from "@/components/inventory/ProductForm";

export default function ProductListPage() {
    const { currentBranch } = useBranch();
    const [products, setProducts] = useState<Product[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedCategory, setSelectedCategory] = useState<string>("all");
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | undefined>(undefined);

    const fetchData = useCallback(async () => {
        if (!currentBranch) return;
        setIsLoading(true);
        try {
            const [productsData, categoriesData] = await Promise.all([
                getProducts(currentBranch.id, {
                    search: searchTerm,
                    categoryId: selectedCategory !== 'all' ? selectedCategory : undefined
                }),
                getCategories()
            ]);
            setProducts(productsData);
            setCategories(categoriesData);
        } catch (error) {
            console.error("Failed to fetch inventory data:", error);
            toast.error("Không thể tải dữ liệu kho hàng");
        } finally {
            setIsLoading(false);
        }
    }, [currentBranch, searchTerm, selectedCategory]);

    useEffect(() => {
        const timer = setTimeout(() => {
            fetchData();
        }, 300); // Debounce search
        return () => clearTimeout(timer);
    }, [fetchData]);

    const handleDelete = async (id: string) => {
        if (!confirm("Bạn có chắc chắn muốn xóa sản phẩm này không?")) return;
        try {
            await deleteProduct(id);
            toast.success("Đã xóa sản phẩm");
            fetchData();
        } catch (error) {
            console.error("Delete failed:", error);
            toast.error("Xóa thất bại");
        }
    };

    const handleEdit = (product: Product) => {
        setEditingProduct(product);
        setIsFormOpen(true);
    };

    const handleCreate = () => {
        setEditingProduct(undefined);
        setIsFormOpen(true);
    };

    const handleFormSubmit = () => {
        setIsFormOpen(false);
        fetchData();
    };

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);
    };

    return (
        <div className="space-y-6 pb-20 animate-fade-in">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                    <div className="relative flex-1 sm:w-80">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Tìm kiếm sản phẩm..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50 dark:bg-slate-900/50 dark:text-white"
                        />
                    </div>
                    <div className="sm:hidden">
                        <button className="p-2 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700">
                            <Filter className="w-5 h-5 text-slate-500" />
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                    <select
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value)}
                        className="hidden sm:block px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-800 dark:text-white"
                    >
                        <option value="all">Tất cả danh mục</option>
                        {categories.map(cat => (
                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                        ))}
                    </select>

                    <button
                        onClick={handleCreate}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors w-full sm:w-auto shadow-lg shadow-blue-500/20"
                    >
                        <Plus className="w-4 h-4" />
                        Thêm sản phẩm
                    </button>
                </div>
            </div>

            {/* Product Grid/Table */}
            {isLoading ? (
                <div className="flex justify-center py-20">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
            ) : products.length === 0 ? (
                <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
                    <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    <h3 className="text-lg font-medium text-slate-900 dark:text-white">Chưa có sản phẩm nào</h3>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">Bắt đầu bằng cách thêm sản phẩm mới vào kho.</p>
                </div>
            ) : (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-50 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 font-medium border-b border-slate-200 dark:border-slate-700">
                                <tr>
                                    <th className="px-4 py-3 w-12">#</th>
                                    <th className="px-4 py-3">Sản phẩm</th>
                                    <th className="px-4 py-3">Danh mục</th>
                                    <th className="px-4 py-3">Đơn vị</th>
                                    <th className="px-4 py-3 text-right">Giá bán</th>
                                    <th className="px-4 py-3 text-right">Tồn kho</th>
                                    <th className="px-4 py-3 text-center">Trạng thái</th>
                                    <th className="px-4 py-3 w-10"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                {products.map((product, index) => (
                                    <tr key={product.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors group">
                                        <td className="px-4 py-3 text-slate-400">{index + 1}</td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0 overflow-hidden border border-slate-200 dark:border-slate-600">
                                                    {product.image_url ? (
                                                        <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <Package className="w-5 h-5 text-slate-400" />
                                                    )}
                                                </div>
                                                <div>
                                                    <div className="font-medium text-slate-900 dark:text-white">{product.name}</div>
                                                    <div className="text-xs text-slate-500 dark:text-slate-400">{product.code}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                                            {product.category?.name || '-'}
                                        </td>
                                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                                            {product.unit?.name || '-'}
                                        </td>
                                        <td className="px-4 py-3 text-right font-medium text-slate-900 dark:text-white">
                                            {formatCurrency(product.selling_price)}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <span className={cn(
                                                "font-medium",
                                                (product.inventory?.stock_quantity || 0) <= (product.min_stock_level || 0)
                                                    ? "text-red-600 dark:text-red-400"
                                                    : "text-green-600 dark:text-green-400"
                                            )}>
                                                {product.inventory?.stock_quantity || 0}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={cn(
                                                "px-2 py-1 rounded-full text-xs font-medium",
                                                product.is_active
                                                    ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                                    : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400"
                                            )}>
                                                {product.is_active ? 'Hoạt động' : 'Đã ẩn'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => handleEdit(product)}
                                                    className="p-1.5 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                                                    title="Chỉnh sửa"
                                                >
                                                    <Edit className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(product.id)}
                                                    className="p-1.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                                    title="Xóa"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {/* Pagination could go here */}
                    <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-500 dark:text-slate-400 flex justify-between items-center">
                        <span>Hiển thị {products.length} sản phẩm</span>
                        <div className="flex gap-2">
                            <button className="px-3 py-1 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-700 disabled:opacity-50" disabled>Trước</button>
                            <button className="px-3 py-1 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-700 disabled:opacity-50" disabled>Sau</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Product Form Modal */}
            <ProductForm
                isOpen={isFormOpen}
                onClose={() => setIsFormOpen(false)}
                onSubmit={handleFormSubmit}
                initialData={editingProduct}
            />
        </div>
    );
}
