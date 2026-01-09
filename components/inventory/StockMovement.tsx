"use client";

import { useState, useEffect } from "react";
import { useBranch } from "@/contexts/BranchContext";
import { getProducts, updateStock } from "@/lib/api/inventory"; // Add getProducts here? Or assume parent passes it? Better to fetch if standalone.
import { Product, TransactionType } from "@/lib/types/inventory";
import { Search, ArrowDownLeft, ArrowUpRight, AlertTriangle, CheckCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const transactionTypes: { value: TransactionType; label: string; icon: React.ComponentType<{ className?: string }>; color: string }[] = [
    { value: 'import', label: 'Nhập kho', icon: ArrowDownLeft, color: 'text-green-600' },
    { value: 'export', label: 'Xuất hủy', icon: ArrowUpRight, color: 'text-red-600' },
    { value: 'adjustment', label: 'Kiểm kê / Điều chỉnh', icon: AlertTriangle, color: 'text-amber-600' },
    // transfer_in/out usually handled via separate flow, but could be here
];

export function StockMovement() {
    const { currentBranch } = useBranch();
    const [products, setProducts] = useState<Product[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Form State
    const [type, setType] = useState<TransactionType>('import');
    const [quantity, setQuantity] = useState<number>(0);
    const [unitPrice, setUnitPrice] = useState<number>(0);
    const [note, setNote] = useState("");
    const [referenceId, setReferenceId] = useState("");

    // Fetch products for search autocomplete
    useEffect(() => {
        if (!currentBranch) return;
        const fetchProds = async () => {
            try {
                // Fetch simplified list for dropdown
                const data = await getProducts(currentBranch.id, { search: searchTerm });
                setProducts(data);
            } catch (err) {
                console.error(err);
            }
        };

        const timer = setTimeout(() => {
            if (searchTerm.length > 1 || selectedProduct) return; // Don't fetch if already selected or query too short, unless initial load?
            // Actually, maybe just load top 50 initially or on search
            fetchProds();
        }, 300);
        return () => clearTimeout(timer);
    }, [searchTerm, currentBranch]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentBranch || !selectedProduct) return;

        setIsSubmitting(true);
        try {
            // Logic: Export/Adjustment might need negative quantity logic
            // For UI simplicity, user enters positive number. We flip sign based on type.
            let qtyChange = quantity;
            if (type === 'export' || type === 'sale' || type === 'transfer_out') {
                qtyChange = -Math.abs(quantity);
            }
            if (type === 'adjustment') {
                // Adjustment is tricky. Usually means "set stock to X". 
                // But updateStock API takes "quantity_change".
                // So we'd need: (New Qty - Old Qty) = Change.
                // For now, let's treat adjustment as "Change by X" (+/-) explicitly? 
                // UX decision: Let's keep it simple: Add/Remove.
                // If user wants to "Set to 100", they used Stock Take feature (future).
                // Here is manual adjustment +/-.
            }

            await updateStock({
                branch_id: currentBranch.id,
                product_id: selectedProduct.id,
                quantity_change: qtyChange,
                type: type,
                unit_price: unitPrice,
                reference_id: referenceId,
                note: note
            });

            toast.success("Giao dịch thành công");

            // Reset form
            setQuantity(0);
            setUnitPrice(0);
            setNote("");
            setSelectedProduct(null);
            setSearchTerm("");

        } catch (error) {
            console.error(error);
            toast.error("Có lỗi xảy ra");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 animate-fade-in max-w-3xl mx-auto">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-6">Tạo phiếu Nhập / Xuất kho</h2>

            <form onSubmit={handleSubmit} className="space-y-6">
                {/* Product Search */}
                <div className="relative z-10">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Sản phẩm <span className="text-red-500">*</span>
                    </label>
                    {selectedProduct ? (
                        <div className="flex items-center justify-between p-3 border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-white dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden">
                                    <img src={selectedProduct.image_url || ''} className="w-full h-full object-cover" alt={selectedProduct.name} />
                                </div>
                                <div>
                                    <div className="font-medium text-slate-900 dark:text-white">{selectedProduct.name}</div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400">
                                        SKU: {selectedProduct.code} | Tồn: {selectedProduct.inventory?.stock_quantity || 0} {selectedProduct.unit?.code}
                                    </div>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedProduct(null)}
                                className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium"
                            >
                                Thay đổi
                            </button>
                        </div>
                    ) : (
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Tìm kiếm theo tên hoặc mã SKU..."
                                className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white dark:bg-slate-700 dark:text-white"
                            />
                            {searchTerm && products.length > 0 && !selectedProduct && (
                                <div className="absolute w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                                    {products.map(prod => (
                                        <div
                                            key={prod.id}
                                            onClick={() => { setSelectedProduct(prod); setSearchTerm(""); }}
                                            className="p-3 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer flex items-center gap-3 transition-colors"
                                        >
                                            <div className="w-8 h-8 bg-slate-100 dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-600 flex-shrink-0">
                                                {prod.image_url && <img src={prod.image_url} className="w-full h-full object-cover rounded" alt={prod.name} />}
                                            </div>
                                            <div>
                                                <div className="text-sm font-medium text-slate-900 dark:text-white">{prod.name}</div>
                                                <div className="text-xs text-slate-500 dark:text-slate-400">{prod.code}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Transaction Type */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {transactionTypes.map((t) => (
                        <div
                            key={t.value}
                            onClick={() => setType(t.value)}
                            className={cn(
                                "cursor-pointer p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2",
                                type === t.value
                                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                                    : "border-slate-100 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-slate-50 dark:bg-slate-900/50"
                            )}
                        >
                            <t.icon className={cn("w-6 h-6", type === t.value ? "text-blue-600 dark:text-blue-400" : "text-slate-400")} />
                            <span className={cn("text-sm font-medium", type === t.value ? "text-slate-900 dark:text-white" : "text-slate-500 dark:text-slate-400")}>
                                {t.label}
                            </span>
                        </div>
                    ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Số lượng ({selectedProduct?.unit?.code || 'đơn vị'}) <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="number"
                            min="0.1"
                            step="0.01"
                            required
                            value={quantity || ''}
                            onChange={(e) => setQuantity(Number(e.target.value))}
                            className="w-full px-4 py-2.5 text-sm border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white dark:bg-slate-700 dark:text-white"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Đơn giá nhập/vốn (VND)
                        </label>
                        <input
                            type="number"
                            min="0"
                            value={unitPrice || ''}
                            onChange={(e) => setUnitPrice(Number(e.target.value))}
                            className="w-full px-4 py-2.5 text-sm border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white dark:bg-slate-700 dark:text-white"
                            placeholder="0"
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Mã tham chiếu (Phiếu, Hóa đơn)
                    </label>
                    <input
                        type="text"
                        value={referenceId}
                        onChange={(e) => setReferenceId(e.target.value)}
                        className="w-full px-4 py-2.5 text-sm border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white dark:bg-slate-700 dark:text-white"
                        placeholder="VD: PO-2025-001"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Ghi chú
                    </label>
                    <textarea
                        rows={3}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        className="w-full px-4 py-2.5 text-sm border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white dark:bg-slate-700 dark:text-white resize-none"
                    />
                </div>

                <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-700">
                    <button
                        type="submit"
                        disabled={isSubmitting || !selectedProduct}
                        className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:shadow-none"
                    >
                        {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                        Xác nhận giao dịch
                    </button>
                </div>
            </form>
        </div>
    );
}
