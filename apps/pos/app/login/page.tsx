"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) router.replace("/");
  }, [user, router]);

  const handleLogin = async () => {
    setError(null);
    if (!supabase || !isSupabaseConfigured) {
      setError("Chưa cấu hình Supabase. Vui lòng thêm ENV trên Vercel.");
      return;
    }
    if (!email.trim() || !password) {
      setError("Vui lòng nhập email và mật khẩu.");
      return;
    }
    setBusy(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
      router.replace("/");
    } catch (e: any) {
      setError(e?.message ?? "Đăng nhập thất bại.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-blue-300" />
          </div>
          <div>
            <div className="text-lg font-bold">Đăng nhập POS</div>
            <div className="text-xs text-slate-400">Sử dụng tài khoản OneBiz của anh</div>
          </div>
        </div>

        {error && (
          <div className="mt-4 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">
            {error}
          </div>
        )}

        <div className="mt-4 space-y-3">
          <label className="block">
            <div className="text-[11px] font-bold text-slate-300 mb-1">Email</div>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-white/10 text-sm"
              placeholder="email@domain.com"
            />
          </label>
          <label className="block">
            <div className="text-[11px] font-bold text-slate-300 mb-1">Mật khẩu</div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-white/10 text-sm"
              placeholder="••••••••"
            />
          </label>
          <button
            onClick={() => void handleLogin()}
            disabled={busy}
            className="w-full py-2.5 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-60 font-bold text-sm"
          >
            {busy ? "Đang đăng nhập..." : "Đăng nhập"}
          </button>
        </div>
      </div>
    </main>
  );
}
