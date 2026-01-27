import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function FloorPlanPage() {
    return (
        <main className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-6">
            <div className="max-w-md w-full bg-white/5 border border-white/10 rounded-2xl p-6 text-center space-y-3">
                <div className="text-lg font-bold">Sơ đồ bàn</div>
                <div className="text-xs text-slate-400">
                    Tính năng bàn sẽ triển khai sau. Hiện tại dùng POS bán nhanh.
                </div>
                <div className="flex gap-2 justify-center">
                    <Link href="/" className="px-3 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-xs font-bold">
                        Về POS bán nhanh
                    </Link>
                    <Link href="/" className="px-3 py-2 rounded-lg border border-white/10 text-xs font-bold">
                        <ArrowLeft className="w-4 h-4 inline-block mr-1" /> Quay lại
                    </Link>
                </div>
            </div>
        </main>
    );
}
