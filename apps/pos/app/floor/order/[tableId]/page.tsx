import Link from "next/link";

export default function OrderPage() {
    return (
        <main className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-6">
            <div className="max-w-md w-full bg-white/5 border border-white/10 rounded-2xl p-6 text-center space-y-3">
                <div className="text-lg font-bold">Order theo bàn</div>
                <div className="text-xs text-slate-400">
                    Tính năng này sẽ làm ở giai đoạn sau. Hiện dùng POS bán nhanh.
                </div>
                <Link href="/" className="px-3 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-xs font-bold">
                    Về POS bán nhanh
                </Link>
            </div>
        </main>
    );
}
