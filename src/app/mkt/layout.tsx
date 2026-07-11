import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getMktDatabaseClient } from "@/lib/mkt/supabase";
import { MktNav } from "@/components/mkt/mkt-nav";
import type { MktContext } from "@/lib/mkt/context";

export const dynamic = "force-dynamic";

async function loadContext(): Promise<{ signedIn: boolean; ctx: MktContext }> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { signedIn: false, ctx: { canView: false } };

  const db = getMktDatabaseClient(supabase);
  const { data } = await db.rpc<MktContext>("mkt_get_my_context", {});
  return { signedIn: true, ctx: (data as MktContext) ?? { canView: false } };
}

function AccessNotice({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <Icon name="lock" size={40} className="text-on-surface-variant" />
      <div className="max-w-md space-y-2">
        <h1 className="font-heading text-xl font-bold text-on-surface">
          {signedIn ? "Bạn chưa được cấp quyền vào MKT Hub" : "Vui lòng đăng nhập"}
        </h1>
        <p className="text-sm text-on-surface-variant">
          {signedIn
            ? "Liên hệ quản trị viên để được cấp quyền “Xem MKT Hub”. Nếu bạn phụ trách marketing, hãy yêu cầu gán vai trò MKT tương ứng."
            : "Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục."}
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-outline-variant bg-background px-4 text-sm font-medium hover:bg-surface-container"
      >
        <Icon name="arrow_back" size={18} />
        Về OneBiz ERP
      </Link>
    </div>
  );
}

export default async function MktLayout({ children }: { children: React.ReactNode }) {
  const { signedIn, ctx } = await loadContext();

  if (!ctx.canView) {
    return (
      <div className="min-h-screen bg-surface-container-low text-on-surface">
        <AccessNotice signedIn={signedIn} />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface-container-low text-on-surface">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-outline-variant bg-background px-4 sm:px-6">
        <Link href="/mkt" className="flex items-center gap-2 font-heading text-base font-bold">
          <Icon name="campaign" size={22} className="text-primary" />
          MKT Hub
        </Link>
        <Link
          href="/"
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-outline-variant bg-background px-3 text-sm font-medium hover:bg-surface-container"
        >
          <Icon name="grid_view" size={18} />
          <span className="hidden sm:inline">OneBiz ERP</span>
        </Link>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <MktNav ctx={ctx} />
        <main className="min-w-0 flex-1 pb-20 lg:pb-0">{children}</main>
      </div>
    </div>
  );
}
