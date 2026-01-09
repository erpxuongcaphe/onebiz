"use client";

import { useState, useEffect, useRef } from "react";
import { Product, CreateProductInput, Category, Unit } from "@/lib/types/inventory";
import { createProduct, updateProduct, getCategories, getUnits } from "@/lib/api/inventory";
import { X, Loader2, ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

interface ProductFormProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: () => void;
    initialData?: Product;
}

export function ProductForm({ isOpen, onClose, onSubmit, initialData }: ProductFormProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [categories, setCategories] = useState<Category[]>([]);
    const [units, setUnits] = useState<Unit[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);

    const [form, setForm] = useState<Partial<CreateProductInput>>({
        type: 'finished_product'
    });

    useEffect(() => {
        if (isOpen) {
            // Load categories and units
            Promise.all([getCategories(), getUnits()]).then(([cats, us]) => {
                setCategories(cats);
                setUnits(us);
            });

            if (initialData) {
                setForm({
                    code: initialData.code,
                    name: initialData.name,
                    category_id: initialData.category_id,
                    unit_id: initialData.unit_id,
                    type: initialData.type,
                    cost_price: initialData.cost_price,
                    selling_price: initialData.selling_price,
                    min_stock_level: initialData.min_stock_level,
                    description: initialData.description,
                    image_url: initialData.image_url,
                });
                setImagePreview(initialData.image_url || null);
            } else {
                setForm({
                    type: 'finished_product',
                    cost_price: 0,
                    selling_price: 0,
                    min_stock_level: 10
                });
                setImagePreview(null);
            }
        }
    }, [isOpen, initialData]);

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            // Simple validation
            if (file.size > 2 * 1024 * 1024) {
                toast.error("File ảnh không được quá 2MB");
                return;
            }

            // Create preview
            const objectUrl = URL.createObjectURL(file);
            setImagePreview(objectUrl);

            // Upload Logic (Simplified)
            const fileExt = file.name.split('.').pop();
            const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
            const filePath = `products/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('products')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
                .from('products')
                .getPublicUrl(filePath);

            setForm(prev => ({ ...prev, image_url: publicUrl }));

        } catch (error) {
            console.error("Upload failed", error);
            toast.error("Lỗi tải ảnh lên");
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);

        try {
            // Validation
            if (!form.code || !form.name) {
                toast.error("Vui lòng điền các trường bắt buộc");
                setIsLoading(false);
                return;
            }

            if (initialData) {
                await updateProduct(initialData.id, form);
                toast.success("Cập nhật sản phẩm thành công");
            } else {
                await createProduct(form as CreateProductInput);
                toast.success("Thêm sản phẩm thành công");
            }
            onSubmit();
        } catch (error) {
            console.error("Save failed:", error);
            toast.error("Lỗi khi lưu sản phẩm");
        } finally {
            setIsLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <div
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
                onClick={onClose}
            />

            <div className="relative w-full max-w-2xl bg-white dark:bg-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] animate-scale-in">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-700">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                        {initialData ? "Chỉnh sửa sản phẩm" : "Thêm sản phẩm mới"}
                    </h2>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    <form id="product-form" onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            {/* Image Upload */}
                            <div className="sm:col-span-2 flex justify-center">
                                <div
                                    className="relative w-32 h-32 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-400 flex items-center justify-center cursor-pointer group overflow-hidden bg-slate-50 dark:bg-slate-900/50"
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    {imagePreview ? (
                                        <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="text-center p-4">
                                            <ImagePlus className="w-8 h-8 text-slate-400 mx-auto mb-2 group-hover:text-blue-500 transition-colors" />
                                            <span className="text-xs text-slate-500 dark:text-slate-400">Tải ảnh lên</span>
                                        </div>
                                    )}
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        className="hidden"
                                        accept="image/*"
                                        onChange={handleImageUpload}
                                    />
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Mã sản phẩm (SKU) <span className="text-red-500">*</span></label>
                                    <input
                                        type="text"
                                        required
                                        value={form.code || ''}
                                        onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })}
                                        className="w-full px-4 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white dark:bg-slate-700 dark:text-white"
                                        placeholder="VD: CF001"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tên sản phẩm <span className="text-red-500">*</span></label>
                                    <input
                                        type="text"
                                        required
                                        value={form.name || ''}
                                        onChange={e => setForm({ ...form, name: e.target.value })}
                                        className="w-full px-4 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white dark:bg-slate-700 dark:text-white"
                                        placeholder="VD: Cà phê sữa đá"
                                    />
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Danh mục</label>
                                    <select
                                        value={form.category_id || ''}
                                        onChange={e => setForm({ ...form, category_id: e.target.value })}
                                        className="w-full px-4 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white dark:bg-slate-700 dark:text-white"
                                    >
                                        <option value="">-- Chọn danh mục --</option>
                                        {categories.map(c => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Đơn vị tính</label>
                                    <select
                                        value={form.unit_id || ''}
                                        onChange={e => setForm({ ...form, unit_id: e.target.value })}
                                        className="w-full px-4 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white dark:bg-slate-700 dark:text-white"
                                    >
                                        <option value="">-- Chọn đơn vị --</option>
                                        {units.map(u => (
                                            <option key={u.id} value={u.id}>{u.name} ({u.code})</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Loại sản phẩm</label>
                                <div className="flex gap-4">
                                    <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="type"
                                            value="finished_product"
                                            checked={form.type === 'finished_product'}
                                            onChange={() => setForm({ ...form, type: 'finished_product' })}
                                            className="text-blue-600 focus:ring-blue-500 border-slate-300"
                                        />
                                        Thành phẩm (Bán)
                                    </label>
                                    <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="type"
                                            value="raw_material"
                                            checked={form.type === 'raw_material'}
                                            onChange={() => setForm({ ...form, type: 'raw_material' })}
                                            className="text-blue-600 focus:ring-blue-500 border-slate-300"
                                        />
                                        Nguyên liệu (Kho)
                                    </label>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Giá vốn</label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={form.cost_price?.toString()}
                                        onChange={e => setForm({ ...form, cost_price: Number(e.target.value) })}
                                        className="w-full px-4 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white dark:bg-slate-700 dark:text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Giá bán</label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={form.selling_price?.toString()}
                                        onChange={e => setForm({ ...form, selling_price: Number(e.target.value) })}
                                        className="w-full px-4 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white dark:bg-slate-700 dark:text-white"
                                    />
                                </div>
                            </div>

                            <div className="sm:col-span-2">
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Mô tả</label>
                                <textarea
                                    rows={3}
                                    value={form.description || ''}
                                    onChange={e => setForm({ ...form, description: e.target.value })}
                                    className="w-full px-4 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white dark:bg-slate-700 dark:text-white resize-none"
                                />
                            </div>
                        </div>
                    </form>
                </div>

                <div className="p-6 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex justify-end gap-3 rounded-b-2xl">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    >
                        Hủy
                    </button>
                    <button
                        type="submit"
                        form="product-form"
                        disabled={isLoading}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
                    >
                        {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                        {initialData ? 'Lưu thay đổi' : 'Thêm sản phẩm'}
                    </button>
                </div>
            </div>
        </div>
    );
}
