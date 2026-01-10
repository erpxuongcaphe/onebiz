"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Plus, Minus, Send, X, Search } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

// Mock menu items
const menuCategories = [
    { id: "coffee", name: "Cà phê", icon: "☕" },
    { id: "tea", name: "Trà", icon: "🍵" },
    { id: "smoothie", name: "Sinh tố", icon: "🥤" },
    { id: "food", name: "Đồ ăn", icon: "🍜" },
    { id: "dessert", name: "Tráng miệng", icon: "🍰" },
];

const menuItems = [
    { id: "1", name: "Cà phê đen", category: "coffee", price: 25000 },
    { id: "2", name: "Cà phê sữa", category: "coffee", price: 29000 },
    { id: "3", name: "Bạc xỉu", category: "coffee", price: 32000 },
    { id: "4", name: "Cappuccino", category: "coffee", price: 45000 },
    { id: "5", name: "Latte", category: "coffee", price: 45000 },
    { id: "6", name: "Americano", category: "coffee", price: 39000 },
    { id: "7", name: "Trà đào", category: "tea", price: 35000 },
    { id: "8", name: "Trà vải", category: "tea", price: 35000 },
    { id: "9", name: "Trà chanh", category: "tea", price: 25000 },
    { id: "10", name: "Sinh tố bơ", category: "smoothie", price: 45000 },
    { id: "11", name: "Sinh tố xoài", category: "smoothie", price: 40000 },
    { id: "12", name: "Bánh mì", category: "food", price: 35000 },
    { id: "13", name: "Bánh flan", category: "dessert", price: 20000 },
];

interface CartItem {
    id: string;
    name: string;
    price: number;
    quantity: number;
    note?: string;
}

interface OrderPageProps {
    params: { tableId: string };
}

export default function OrderPage({ params }: OrderPageProps) {
    const tableId = params.tableId;
    const isNewOrder = tableId === "takeaway" || !tableId;
    const tableName = tableId === "takeaway" ? "Mang đi" : `Bàn ${tableId}`;

    const [selectedCategory, setSelectedCategory] = useState("coffee");
    const [searchQuery, setSearchQuery] = useState("");
    const [cart, setCart] = useState<CartItem[]>([]);
    const [time, setTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const filteredItems = menuItems.filter(item => {
        const matchesCategory = item.category === selectedCategory;
        const matchesSearch = searchQuery === "" || item.name.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesCategory && matchesSearch;
    });

    const addToCart = (item: typeof menuItems[0]) => {
        setCart(prev => {
            const existing = prev.find(c => c.id === item.id);
            if (existing) {
                return prev.map(c => c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c);
            }
            return [...prev, { id: item.id, name: item.name, price: item.price, quantity: 1 }];
        });
    };

    const updateQuantity = (id: string, delta: number) => {
        setCart(prev => {
            return prev.map(item => {
                if (item.id === id) {
                    const newQty = item.quantity + delta;
                    return newQty <= 0 ? null : { ...item, quantity: newQty };
                }
                return item;
            }).filter(Boolean) as CartItem[];
        });
    };

    const removeFromCart = (id: string) => {
        setCart(prev => prev.filter(item => item.id !== id));
    };

    const totalAmount = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('vi-VN').format(value) + 'đ';
    };

    const handleSubmitOrder = () => {
        // TODO: Submit order to backend
        alert(`Đã gửi order ${totalItems} món - ${formatCurrency(totalAmount)}`);
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white flex">
            {/* Left Side - Menu */}
            <div className="flex-1 flex flex-col">
                {/* Header */}
                <header className="bg-slate-900/80 backdrop-blur-xl border-b border-white/10 px-6 py-4">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-4">
                            <Link href="/floor" className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                                <ArrowLeft className="w-6 h-6" />
                            </Link>
                            <div>
                                <h1 className="text-xl font-bold">{tableName}</h1>
                                <p className="text-sm text-slate-400">
                                    {isNewOrder ? "Order mới" : "Thêm món"}
                                </p>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-lg font-bold tabular-nums">
                                {time.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                            </p>
                        </div>
                    </div>

                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Tìm món..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                        />
                    </div>
                </header>

                {/* Category Tabs */}
                <div className="flex items-center gap-2 px-6 py-4 overflow-x-auto border-b border-white/5">
                    {menuCategories.map((cat) => (
                        <button
                            key={cat.id}
                            onClick={() => setSelectedCategory(cat.id)}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full whitespace-nowrap transition-all",
                                selectedCategory === cat.id
                                    ? "bg-blue-500 text-white"
                                    : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
                            )}
                        >
                            <span>{cat.icon}</span>
                            <span>{cat.name}</span>
                        </button>
                    ))}
                </div>

                {/* Menu Grid */}
                <div className="flex-1 p-6 overflow-y-auto">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                        {filteredItems.map((item) => {
                            const inCart = cart.find(c => c.id === item.id);
                            return (
                                <button
                                    key={item.id}
                                    onClick={() => addToCart(item)}
                                    className={cn(
                                        "relative p-4 rounded-2xl text-left transition-all hover:scale-105 border-2",
                                        inCart
                                            ? "bg-blue-500/20 border-blue-400"
                                            : "bg-white/5 border-white/10 hover:border-blue-400"
                                    )}
                                >
                                    <h3 className="font-medium text-white">{item.name}</h3>
                                    <p className="text-lg font-bold text-amber-400 mt-2">
                                        {formatCurrency(item.price)}
                                    </p>
                                    {inCart && (
                                        <div className="absolute top-2 right-2 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-xs font-bold">
                                            {inCart.quantity}
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Right Side - Cart */}
            <div className="w-96 bg-slate-800/50 border-l border-white/10 flex flex-col">
                <div className="p-6 border-b border-white/10">
                    <h2 className="text-lg font-bold">Đơn hàng ({totalItems})</h2>
                </div>

                {/* Cart Items */}
                <div className="flex-1 p-4 overflow-y-auto space-y-3">
                    {cart.length === 0 ? (
                        <div className="text-center py-12 text-slate-500">
                            <p>Chưa có món nào</p>
                            <p className="text-sm mt-1">Chọn món từ menu bên trái</p>
                        </div>
                    ) : (
                        cart.map((item) => (
                            <div key={item.id} className="bg-white/5 rounded-xl p-4">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1">
                                        <h4 className="font-medium">{item.name}</h4>
                                        <p className="text-sm text-amber-400">{formatCurrency(item.price)}</p>
                                    </div>
                                    <button
                                        onClick={() => removeFromCart(item.id)}
                                        className="p-1 text-red-400 hover:bg-red-500/20 rounded"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                                <div className="flex items-center justify-between mt-3">
                                    <div className="flex items-center gap-2 bg-slate-700 rounded-lg">
                                        <button
                                            onClick={() => updateQuantity(item.id, -1)}
                                            className="p-2 hover:bg-slate-600 rounded-l-lg"
                                        >
                                            <Minus className="w-4 h-4" />
                                        </button>
                                        <span className="w-8 text-center font-bold">{item.quantity}</span>
                                        <button
                                            onClick={() => updateQuantity(item.id, 1)}
                                            className="p-2 hover:bg-slate-600 rounded-r-lg"
                                        >
                                            <Plus className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <span className="font-bold text-white">
                                        {formatCurrency(item.price * item.quantity)}
                                    </span>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Cart Footer */}
                <div className="p-6 border-t border-white/10 bg-slate-900/50">
                    <div className="flex items-center justify-between mb-4">
                        <span className="text-slate-400">Tổng cộng</span>
                        <span className="text-2xl font-bold text-amber-400">{formatCurrency(totalAmount)}</span>
                    </div>
                    <button
                        onClick={handleSubmitOrder}
                        disabled={cart.length === 0}
                        className={cn(
                            "w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all",
                            cart.length > 0
                                ? "bg-gradient-to-r from-blue-500 to-cyan-500 text-white hover:shadow-lg hover:shadow-blue-500/30"
                                : "bg-slate-700 text-slate-500 cursor-not-allowed"
                        )}
                    >
                        <Send className="w-5 h-5" />
                        Gửi order
                    </button>
                </div>
            </div>
        </div>
    );
}
