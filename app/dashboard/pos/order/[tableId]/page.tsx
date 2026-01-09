"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useBranch } from "@/contexts/BranchContext";
import { getProducts } from "@/lib/api/inventory";
import { getOrderByTable, createOrder, processPayment } from "@/lib/api/pos";
import { getTables } from "@/lib/api/tables";
import { Product } from "@/lib/types/inventory";
import { Order, CartItem, PaymentMethod } from "@/lib/types/pos";
import {
    Search,
    Plus,
    Minus,
    Trash2,
    ShoppingCart,
    CreditCard,
    Banknote,
    Smartphone,
    X,
    Loader2,
    Coffee,
    ChevronRight,
    Utensils
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

export default function OrderPage() {
    const params = useParams();
    const router = useRouter();
    const { currentBranch } = useBranch();

    const tableId = params.tableId as string;
    const isTakeaway = tableId === "takeaway";

    const [table, setTable] = useState<{ table_number: string; name?: string } | null>(null);
    const [products, setProducts] = useState<Product[]>([]);
    const [existingOrder, setExistingOrder] = useState<Order | null>(null);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedCategory, setSelectedCategory] = useState("all");
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showPayment, setShowPayment] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
    const [amountReceived, setAmountReceived] = useState<number>(0);
    const [isCartOpen, setIsCartOpen] = useState(true); // Toggle for mobile/desktop

    // Fetch data
    useEffect(() => {
        if (!currentBranch) return;

        const fetchData = async () => {
            setIsLoading(true);
            try {
                // Get products
                const productsData = await getProducts(currentBranch.id);
                setProducts(productsData.filter(p => p.type === 'finished_product'));

                // Get table info and existing order
                if (!isTakeaway) {
                    const tables = await getTables(currentBranch.id);
                    const foundTable = tables.find(t => t.id === tableId);
                    setTable(foundTable ? { table_number: foundTable.table_number, name: foundTable.name } : null);

                    // Check for existing order
                    const order = await getOrderByTable(tableId);
                    if (order) {
                        setExistingOrder(order);
                        // Convert order items to cart
                        setCart(order.items?.map(item => ({
                            product_id: item.product_id,
                            product_name: item.product_name,
                            product_code: item.product?.code || '',
                            image_url: item.product?.image_url,
                            quantity: item.quantity,
                            unit_price: item.unit_price,
                            notes: item.notes
                        })) || []);
                    }
                }
            } catch (error) {
                console.error("Failed to fetch data:", error);
                toast.error("Không thể tải dữ liệu");
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [currentBranch, tableId, isTakeaway]);

    // Calculate totals
    const subtotal = cart.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
    const total = subtotal; // Can add discount/tax later
    const change = amountReceived - total;

    // Filter products
    const filteredProducts = products.filter(p => {
        const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            p.code.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = selectedCategory === "all" || p.category_id === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    // Get unique categories
    const categories = Array.from(new Map(
        products.filter(p => p.category).map(p => [p.category?.id, p.category])
    ).values());

    // Add to cart
    const addToCart = useCallback((product: Product) => {
        setCart(prev => {
            const existing = prev.find(item => item.product_id === product.id);
            if (existing) {
                return prev.map(item =>
                    item.product_id === product.id
                        ? { ...item, quantity: item.quantity + 1 }
                        : item
                );
            }
            // Mở cart nếu đang đóng (optional UX choice)
            // setIsCartOpen(true); 
            return [...prev, {
                product_id: product.id,
                product_name: product.name,
                product_code: product.code,
                image_url: product.image_url,
                quantity: 1,
                unit_price: product.selling_price
            }];
        });
    }, []);

    // Update quantity
    const updateQuantity = useCallback((productId: string, delta: number) => {
        setCart(prev => {
            return prev.map(item => {
                if (item.product_id === productId) {
                    const newQty = item.quantity + delta;
                    return newQty > 0 ? { ...item, quantity: newQty } : item;
                }
                return item;
            }).filter(item => item.quantity > 0);
        });
    }, []);

    // Remove from cart
    const removeFromCart = useCallback((productId: string) => {
        setCart(prev => prev.filter(item => item.product_id !== productId));
    }, []);

    // Submit order
    const handleSubmitOrder = async () => {
        if (cart.length === 0) {
            toast.error("Giỏ hàng trống");
            return;
        }
        if (!currentBranch) return;

        setIsSubmitting(true);
        try {
            const order = await createOrder({
                branch_id: currentBranch.id,
                table_id: isTakeaway ? undefined : tableId,
                order_type: isTakeaway ? 'takeaway' : 'dine_in',
                items: cart.map(item => ({
                    product_id: item.product_id,
                    product_name: item.product_name,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                    notes: item.notes
                }))
            });

            setExistingOrder(order);
            toast.success(`Đã tạo đơn ${order.order_number}`);
            setShowPayment(true);
        } catch (error) {
            console.error("Failed to create order:", error);
            toast.error("Không thể tạo đơn hàng");
        } finally {
            setIsSubmitting(false);
        }
    };

    // Process payment
    const handlePayment = async () => {
        if (!existingOrder) return;

        setIsSubmitting(true);
        try {
            await processPayment(existingOrder.id, {
                payment_method: paymentMethod,
                amount_paid: amountReceived || total
            });

            toast.success("Thanh toán thành công! Trừ kho OK.");
            router.push("/dashboard/pos");
        } catch (error) {
            console.error("Payment failed:", error);
            toast.error("Thanh toán thất bại");
        } finally {
            setIsSubmitting(false);
        }
    };

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);
    };

    // Quick amount buttons
    const quickAmounts = [50000, 100000, 200000, 500000];

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
            </div>
        );
    }

    return (
        <div className="flex h-full relative overflow-hidden">
            {/* Left: Products Grid */}
            <div className={cn(
                "flex-1 flex flex-col transition-all duration-300",
                isCartOpen ? "mr-0 md:mr-96" : "mr-0"
            )}>
                {/* Header Actions */}
                <div className="p-4 flex flex-col md:flex-row gap-4 items-center justify-between backdrop-blur-sm bg-white/40 dark:bg-black/20 sticky top-0 z-10 border-b border-white/20 dark:border-white/5">

                    {/* Search & Filter */}
                    <div className="relative w-full md:w-96 group">
                        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                            <Search className="w-4 h-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                        </div>
                        <input
                            type="text"
                            placeholder="Tìm sản phẩm (Tên, Mã)..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-3 text-sm bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border border-white/40 dark:border-white/10 rounded-2xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all shadow-sm outline-none dark:text-white placeholder:text-slate-400"
                        />
                    </div>

                    {/* Table Info Badge */}
                    <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-white/60 dark:bg-white/5 rounded-full border border-white/20 dark:border-white/10 shadow-sm backdrop-blur-md">
                        {isTakeaway ? (
                            <Utensils className="w-4 h-4 text-orange-500" />
                        ) : (
                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        )}
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                            {isTakeaway ? "Mang đi (Takeaway)" : `Bàn ${table?.table_number || tableId}`}
                        </span>
                    </div>
                </div>

                {/* Categories Pills */}
                <div className="px-4 py-2 overflow-x-auto no-scrollbar flex gap-2">
                    <button
                        onClick={() => setSelectedCategory("all")}
                        className={cn(
                            "px-4 py-2 text-sm font-medium rounded-full whitespace-nowrap transition-all duration-300",
                            selectedCategory === "all"
                                ? "bg-blue-600 text-white shadow-lg shadow-blue-500/30 scale-105"
                                : "bg-white/60 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-white/10 border border-white/20 dark:border-white/5 backdrop-blur-sm"
                        )}
                    >
                        Tất cả
                    </button>
                    {categories.map(cat => cat && (
                        <button
                            key={cat.id}
                            onClick={() => setSelectedCategory(cat.id)}
                            className={cn(
                                "px-4 py-2 text-sm font-medium rounded-full whitespace-nowrap transition-all duration-300",
                                selectedCategory === cat.id
                                    ? "bg-blue-600 text-white shadow-lg shadow-blue-500/30 scale-105"
                                    : "bg-white/60 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-white/10 border border-white/20 dark:border-white/5 backdrop-blur-sm"
                            )}
                        >
                            {cat.name}
                        </button>
                    ))}
                </div>

                {/* Products Grid with Framer Motion */}
                <div className="flex-1 overflow-y-auto p-4 content-start">
                    {filteredProducts.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 opacity-50">
                            <Coffee className="w-16 h-16 mb-4 text-slate-400" />
                            <p className="text-lg font-medium text-slate-500">Không tìm thấy món nào</p>
                        </div>
                    ) : (
                        <motion.div
                            layout
                            className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4"
                        >
                            <AnimatePresence>
                                {filteredProducts.map(product => (
                                    <motion.button
                                        layout
                                        initial={{ opacity: 0, scale: 0.9 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.9 }}
                                        transition={{ duration: 0.2 }}
                                        key={product.id}
                                        onClick={() => addToCart(product)}
                                        className="group relative flex flex-col bg-white/60 dark:bg-slate-800/60 backdrop-blur-md border border-white/40 dark:border-white/5 rounded-2xl overflow-hidden hover:shadow-xl hover:shadow-blue-500/10 dark:hover:shadow-blue-900/20 transition-all duration-300 text-left h-full"
                                    >
                                        <div className="aspect-[4/3] w-full overflow-hidden bg-slate-100 dark:bg-slate-900 relative">
                                            {product.image_url ? (
                                                <img
                                                    src={product.image_url}
                                                    alt={product.name}
                                                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center">
                                                    <Coffee className="w-8 h-8 text-slate-300" />
                                                </div>
                                            )}
                                            {/* Overlay Gradient */}
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                                            {/* Quick Add Icon */}
                                            <div className="absolute bottom-3 right-3 w-8 h-8 rounded-full bg-white text-blue-600 flex items-center justify-center shadow-lg translate-y-10 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 transition-all duration-300">
                                                <Plus className="w-5 h-5" />
                                            </div>
                                        </div>

                                        <div className="p-3 flex-1 flex flex-col">
                                            <h4 className="font-semibold text-slate-900 dark:text-slate-100 line-clamp-2 text-sm leading-tight mb-1 flex-1">
                                                {product.name}
                                            </h4>
                                            <p className="font-bold text-blue-600 dark:text-blue-400 text-sm mt-auto">
                                                {formatCurrency(product.selling_price)}
                                            </p>
                                        </div>
                                    </motion.button>
                                ))}
                            </AnimatePresence>
                        </motion.div>
                    )}
                </div>
            </div>

            {/* Floating Cart Toggle for Mobile */}
            {!isCartOpen && (
                <button
                    onClick={() => setIsCartOpen(true)}
                    className="fixed bottom-24 right-4 z-40 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center md:hidden animate-bounce"
                >
                    <div className="relative">
                        <ShoppingCart className="w-6 h-6" />
                        {cart.length > 0 && (
                            <span className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full text-[10px] font-bold flex items-center justify-center border-2 border-blue-600">
                                {cart.length}
                            </span>
                        )}
                    </div>
                </button>
            )}

            {/* Right: Cart Sidebar (Glassmorphism) */}
            <AnimatePresence>
                {isCartOpen && (
                    <motion.div
                        initial={{ x: "100%" }}
                        animate={{ x: 0 }}
                        exit={{ x: "100%" }}
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        className="fixed inset-y-0 right-0 z-30 w-full md:w-96 bg-white/90 dark:bg-slate-900/90 backdrop-blur-2xl border-l border-white/20 dark:border-white/10 shadow-2xl flex flex-col md:absolute"
                    >
                        {/* Cart Header */}
                        <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-black/20">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
                                    <ShoppingCart className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900 dark:text-white">Giỏ hàng</h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">{cart.length} món</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsCartOpen(false)}
                                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-500"
                            >
                                <ChevronRight className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Cart Items List */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            <AnimatePresence initial={false}>
                                {cart.length === 0 ? (
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className="flex flex-col items-center justify-center h-full text-center space-y-4 opacity-70"
                                    >
                                        <div className="w-32 h-32 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center">
                                            <ShoppingCart className="w-12 h-12 text-slate-300" />
                                        </div>
                                        <p className="text-slate-500 font-medium">Chưa có món nào</p>
                                    </motion.div>
                                ) : (
                                    cart.map(item => (
                                        <motion.div
                                            key={item.product_id}
                                            layout
                                            initial={{ opacity: 0, x: 20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: -20, height: 0 }}
                                            className="flex gap-4 p-3 bg-white dark:bg-black/20 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm"
                                        >
                                            <div className="w-16 h-16 rounded-xl bg-slate-100 dark:bg-slate-800 overflow-hidden flex-shrink-0">
                                                {item.image_url ? (
                                                    <img src={item.image_url} className="w-full h-full object-cover" alt="" />
                                                ) : <div />}
                                            </div>
                                            <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                                                <div className="flex justify-between items-start gap-2">
                                                    <h4 className="font-semibold text-slate-900 dark:text-white text-sm truncate">
                                                        {item.product_name}
                                                    </h4>
                                                    <button
                                                        onClick={() => removeFromCart(item.product_id)}
                                                        className="text-slate-400 hover:text-red-500 transition-colors"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                                <div className="flex items-center justify-between mt-2">
                                                    <p className="text-sm font-bold text-blue-600 dark:text-blue-400">
                                                        {formatCurrency(item.unit_price * item.quantity)}
                                                    </p>
                                                    <div className="flex items-center gap-3 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
                                                        <button
                                                            onClick={() => updateQuantity(item.product_id, -1)}
                                                            className="w-6 h-6 flex items-center justify-center rounded-md bg-white dark:bg-slate-700 shadow-sm text-slate-600 dark:text-slate-300 hover:scale-105 active:scale-95 transition-transform"
                                                        >
                                                            <Minus className="w-3 h-3" />
                                                        </button>
                                                        <span className="text-xs font-bold w-4 text-center">{item.quantity}</span>
                                                        <button
                                                            onClick={() => updateQuantity(item.product_id, 1)}
                                                            className="w-6 h-6 flex items-center justify-center rounded-md bg-white dark:bg-slate-700 shadow-sm text-slate-600 dark:text-slate-300 hover:scale-105 active:scale-95 transition-transform"
                                                        >
                                                            <Plus className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </motion.div>
                                    ))
                                )}
                            </AnimatePresence>
                        </div>

                        {/* Cart Footer Total */}
                        <div className="p-5 bg-white dark:bg-black/40 border-t border-slate-200 dark:border-white/10 space-y-4">
                            <div className="space-y-2">
                                <div className="flex justify-between text-sm text-slate-500 dark:text-slate-400">
                                    <span>Tạm tính</span>
                                    <span>{formatCurrency(subtotal)}</span>
                                </div>
                                <div className="flex justify-between text-xl font-bold text-slate-900 dark:text-white items-end">
                                    <span>Tổng cộng</span>
                                    <span className="text-blue-600 dark:text-blue-400 text-2xl">{formatCurrency(total)}</span>
                                </div>
                            </div>

                            <button
                                onClick={existingOrder ? () => setShowPayment(true) : handleSubmitOrder}
                                disabled={cart.length === 0 || isSubmitting}
                                className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-slate-300 disabled:to-slate-400 disabled:cursor-not-allowed text-white font-bold rounded-2xl shadow-lg shadow-blue-500/30 transition-all active:scale-[0.98] flex items-center justify-center gap-3"
                            >
                                {isSubmitting ? (
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                    <>
                                        <CreditCard className="w-5 h-5" />
                                        {existingOrder ? "THANH TOÁN LẠI" : "TẠO ĐƠN & THANH TOÁN"}
                                    </>
                                )}
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Payment Modal (Overlay) */}
            <AnimatePresence>
                {showPayment && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                            onClick={() => setShowPayment(false)}
                        />
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            className="relative bg-white dark:bg-slate-900 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden"
                        >
                            {/* Modal Header */}
                            <div className="p-6 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex justify-between items-center">
                                <h3 className="text-xl font-bold">Thanh toán</h3>
                                <button onClick={() => setShowPayment(false)} className="p-2 hover:bg-white/20 rounded-full transition-colors">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="p-6 md:p-8 space-y-8">
                                {/* Total Amount */}
                                <div className="text-center space-y-2">
                                    <span className="text-slate-500 dark:text-slate-400 text-sm uppercase tracking-wider">Tổng tiền phải thu</span>
                                    <div className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">
                                        {formatCurrency(total)}
                                    </div>
                                </div>

                                {/* Methods Grid */}
                                <div className="grid grid-cols-3 gap-3">
                                    {[
                                        { value: 'cash', label: 'Tiền mặt', icon: Banknote, color: 'text-green-500' },
                                        { value: 'card', label: 'Thẻ / Pos', icon: CreditCard, color: 'text-blue-500' },
                                        { value: 'momo', label: 'MoMo', icon: Smartphone, color: 'text-pink-500' },
                                    ].map(method => (
                                        <button
                                            key={method.value}
                                            onClick={() => setPaymentMethod(method.value as PaymentMethod)}
                                            className={cn(
                                                "relative flex flex-col items-center justify-center gap-3 p-4 rounded-2xl border-2 transition-all duration-300",
                                                paymentMethod === method.value
                                                    ? "border-blue-600 bg-blue-50 dark:bg-blue-900/10 shadow-lg shadow-blue-500/10 scale-105"
                                                    : "border-slate-100 dark:border-slate-700 hover:border-blue-200 dark:hover:border-slate-600 bg-slate-50 dark:bg-slate-800"
                                            )}
                                        >
                                            {paymentMethod === method.value && (
                                                <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-blue-600" />
                                            )}
                                            <method.icon className={cn("w-8 h-8", method.color)} />
                                            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{method.label}</span>
                                        </button>
                                    ))}
                                </div>

                                {/* Cash Specific UI */}
                                {paymentMethod === 'cash' && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        className="space-y-4"
                                    >
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Khách đưa</label>
                                            <div className="relative">
                                                <input
                                                    type="number"
                                                    value={amountReceived || ''}
                                                    onChange={(e) => setAmountReceived(Number(e.target.value))}
                                                    className="w-full px-4 py-4 text-xl font-bold border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-slate-50 dark:bg-black/20 dark:text-white"
                                                    placeholder="0"
                                                />
                                            </div>
                                        </div>

                                        <div className="flex gap-2">
                                            {quickAmounts.map(amt => (
                                                <button
                                                    key={amt}
                                                    onClick={() => setAmountReceived(amt)}
                                                    className="flex-1 py-2 text-xs font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:border-blue-500 hover:text-blue-500 transition-colors"
                                                >
                                                    {amt / 1000}k
                                                </button>
                                            ))}
                                        </div>

                                        {amountReceived >= total && (
                                            <div className="p-4 bg-green-50 dark:bg-green-900/10 rounded-xl border border-green-100 dark:border-green-900/30 flex justify-between items-center">
                                                <span className="text-green-700 dark:text-green-400 font-medium">Tiền thừa trả khách</span>
                                                <span className="text-xl font-bold text-green-700 dark:text-green-400">{formatCurrency(change)}</span>
                                            </div>
                                        )}
                                    </motion.div>
                                )}

                                <button
                                    onClick={handlePayment}
                                    disabled={isSubmitting || (paymentMethod === 'cash' && amountReceived < total && amountReceived > 0)}
                                    className="w-full py-5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-lg font-bold rounded-2xl shadow-xl shadow-blue-500/20 transition-transform active:scale-[0.98] flex items-center justify-center gap-2"
                                >
                                    {isSubmitting ? <Loader2 className="w-6 h-6 animate-spin" /> : "HOÀN TẤT THANH TOÁN"}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
