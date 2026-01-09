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
    ArrowLeft,
    Search,
    Plus,
    Minus,
    Trash2,
    ShoppingCart,
    CreditCard,
    Banknote,
    Smartphone,
    X,
    Check,
    Loader2,
    Coffee
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import Link from "next/link";

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

            toast.success("Thanh toán thành công!");
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
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="flex h-full">
            {/* Left: Products */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Header */}
                <div className="p-4 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-4 mb-4">
                        <Link
                            href="/dashboard/pos"
                            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                                {isTakeaway ? "Mang đi" : `Bàn ${table?.table_number || tableId}`}
                            </h2>
                            {existingOrder && (
                                <p className="text-xs text-blue-600 dark:text-blue-400">
                                    Đơn: {existingOrder.order_number}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Tìm sản phẩm..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-slate-50 dark:bg-slate-900 dark:text-white"
                        />
                    </div>
                </div>

                {/* Categories */}
                <div className="flex gap-2 px-4 py-3 overflow-x-auto bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                    <button
                        onClick={() => setSelectedCategory("all")}
                        className={cn(
                            "px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-colors",
                            selectedCategory === "all"
                                ? "bg-blue-600 text-white"
                                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                        )}
                    >
                        Tất cả
                    </button>
                    {categories.map(cat => cat && (
                        <button
                            key={cat.id}
                            onClick={() => setSelectedCategory(cat.id)}
                            className={cn(
                                "px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-colors",
                                selectedCategory === cat.id
                                    ? "bg-blue-600 text-white"
                                    : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                            )}
                        >
                            {cat.name}
                        </button>
                    ))}
                </div>

                {/* Products Grid */}
                <div className="flex-1 overflow-y-auto p-4">
                    {filteredProducts.length === 0 ? (
                        <div className="text-center py-12">
                            <Coffee className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                            <p className="text-slate-500">Không tìm thấy sản phẩm</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                            {filteredProducts.map(product => (
                                <button
                                    key={product.id}
                                    onClick={() => addToCart(product)}
                                    className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-left hover:border-blue-400 dark:hover:border-blue-600 hover:shadow-md transition-all"
                                >
                                    <div className="aspect-square rounded-lg bg-slate-100 dark:bg-slate-700 mb-2 overflow-hidden">
                                        {product.image_url ? (
                                            <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center">
                                                <Coffee className="w-8 h-8 text-slate-300" />
                                            </div>
                                        )}
                                    </div>
                                    <h4 className="text-sm font-medium text-slate-900 dark:text-white line-clamp-2 mb-1">
                                        {product.name}
                                    </h4>
                                    <p className="text-sm font-bold text-blue-600 dark:text-blue-400">
                                        {formatCurrency(product.selling_price)}
                                    </p>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Right: Cart */}
            <div className="w-80 lg:w-96 bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 flex flex-col">
                <div className="p-4 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <ShoppingCart className="w-5 h-5" />
                        Giỏ hàng ({cart.length})
                    </h3>
                </div>

                {/* Cart Items */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {cart.length === 0 ? (
                        <div className="text-center py-8">
                            <ShoppingCart className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                            <p className="text-slate-500 text-sm">Chọn sản phẩm để thêm vào giỏ</p>
                        </div>
                    ) : (
                        cart.map(item => (
                            <div key={item.product_id} className="flex gap-3 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                <div className="w-12 h-12 rounded-lg bg-slate-200 dark:bg-slate-700 flex-shrink-0 overflow-hidden">
                                    {item.image_url && <img src={item.image_url} alt="" className="w-full h-full object-cover" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h4 className="text-sm font-medium text-slate-900 dark:text-white truncate">
                                        {item.product_name}
                                    </h4>
                                    <p className="text-xs text-slate-500">{formatCurrency(item.unit_price)}</p>
                                    <div className="flex items-center gap-2 mt-2">
                                        <button
                                            onClick={() => updateQuantity(item.product_id, -1)}
                                            className="p-1 rounded bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600"
                                        >
                                            <Minus className="w-3 h-3" />
                                        </button>
                                        <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                                        <button
                                            onClick={() => updateQuantity(item.product_id, 1)}
                                            className="p-1 rounded bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600"
                                        >
                                            <Plus className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm font-bold text-slate-900 dark:text-white">
                                        {formatCurrency(item.quantity * item.unit_price)}
                                    </p>
                                    <button
                                        onClick={() => removeFromCart(item.product_id)}
                                        className="p-1 mt-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Cart Footer */}
                <div className="p-4 border-t border-slate-200 dark:border-slate-700 space-y-4">
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-500">Tạm tính</span>
                            <span className="font-medium text-slate-900 dark:text-white">{formatCurrency(subtotal)}</span>
                        </div>
                        <div className="flex justify-between text-lg font-bold">
                            <span className="text-slate-900 dark:text-white">Tổng cộng</span>
                            <span className="text-blue-600 dark:text-blue-400">{formatCurrency(total)}</span>
                        </div>
                    </div>

                    <button
                        onClick={existingOrder ? () => setShowPayment(true) : handleSubmitOrder}
                        disabled={cart.length === 0 || isSubmitting}
                        className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
                    >
                        {isSubmitting ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            <>
                                <CreditCard className="w-5 h-5" />
                                {existingOrder ? "Thanh toán" : "Tạo đơn & Thanh toán"}
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Payment Modal */}
            {showPayment && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/50" onClick={() => setShowPayment(false)} />
                    <div className="relative bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md p-6">
                        <button
                            onClick={() => setShowPayment(false)}
                            className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg"
                        >
                            <X className="w-5 h-5" />
                        </button>

                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6">Thanh toán</h3>

                        {/* Total */}
                        <div className="text-center mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
                            <p className="text-sm text-slate-500 dark:text-slate-400">Tổng tiền</p>
                            <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{formatCurrency(total)}</p>
                        </div>

                        {/* Payment Method */}
                        <div className="mb-6">
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Phương thức</label>
                            <div className="grid grid-cols-3 gap-2">
                                {[
                                    { value: 'cash', label: 'Tiền mặt', icon: Banknote },
                                    { value: 'card', label: 'Thẻ', icon: CreditCard },
                                    { value: 'momo', label: 'MoMo', icon: Smartphone },
                                ].map(method => (
                                    <button
                                        key={method.value}
                                        onClick={() => setPaymentMethod(method.value as PaymentMethod)}
                                        className={cn(
                                            "flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all",
                                            paymentMethod === method.value
                                                ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                                                : "border-slate-200 dark:border-slate-700 hover:border-slate-300"
                                        )}
                                    >
                                        <method.icon className={cn(
                                            "w-6 h-6",
                                            paymentMethod === method.value ? "text-blue-600" : "text-slate-400"
                                        )} />
                                        <span className="text-xs font-medium">{method.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Amount Received (for cash) */}
                        {paymentMethod === 'cash' && (
                            <div className="mb-6">
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Tiền khách đưa</label>
                                <input
                                    type="number"
                                    value={amountReceived || ''}
                                    onChange={(e) => setAmountReceived(Number(e.target.value))}
                                    placeholder={formatCurrency(total)}
                                    className="w-full px-4 py-3 text-lg font-medium border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white dark:bg-slate-900 dark:text-white"
                                />
                                <div className="flex gap-2 mt-2">
                                    {quickAmounts.map(amt => (
                                        <button
                                            key={amt}
                                            onClick={() => setAmountReceived(amt)}
                                            className="flex-1 py-2 text-xs font-medium bg-slate-100 dark:bg-slate-700 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600"
                                        >
                                            {(amt / 1000)}k
                                        </button>
                                    ))}
                                </div>
                                {amountReceived >= total && (
                                    <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-center">
                                        <p className="text-sm text-slate-500">Tiền thừa</p>
                                        <p className="text-xl font-bold text-green-600">{formatCurrency(change)}</p>
                                    </div>
                                )}
                            </div>
                        )}

                        <button
                            onClick={handlePayment}
                            disabled={isSubmitting || (paymentMethod === 'cash' && amountReceived < total && amountReceived > 0)}
                            className="w-full py-4 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
                        >
                            {isSubmitting ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <>
                                    <Check className="w-5 h-5" />
                                    Xác nhận thanh toán
                                </>
                            )}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
