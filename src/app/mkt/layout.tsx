import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { getMktRequestContext } from "@/lib/mkt/request-context";
import { MktNav } from "@/components/mkt/mkt-nav";
import { MktUserMenu } from "@/components/mkt/mkt-user-menu";
import { MktLink, MktRoutingProvider } from "@/components/mkt/mkt-routing";
import { getMktBasePath } from "@/lib/mkt/server-routing";

export const dynamic = "force-dynamic";

const ONEBIZ_URL = process.env.ONEBIZ_BASE_URL || "https://onebiz.com.vn";

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
      <div className="flex items-center gap-2">
        <Link
          href={ONEBIZ_URL}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-outline-variant bg-background px-4 text-sm font-medium hover:bg-surface-container"
        >
          <Icon name="arrow_back" size={18} />
          Về OneBiz ERP
        </Link>
        <MktUserMenu />
      </div>
    </div>
  );
}

export default async function MktLayout({ children }: { children: React.ReactNode }) {
  const [{ signedIn, ctx }, basePath] = await Promise.all([
    getMktRequestContext(),
    getMktBasePath(),
  ]);

  if (!ctx.canView) {
    return (
      <div className="min-h-screen bg-surface-container-low text-on-surface">
        <AccessNotice signedIn={signedIn} />
      </div>
    );
  }

  return (
    <MktRoutingProvider basePath={basePath}>
      <div className="flex min-h-screen flex-col bg-surface-container-low text-on-surface">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-outline-variant bg-background px-4 sm:px-6">
        <MktLink href="/mkt" className="flex items-center gap-2 font-heading text-base font-bold">
          <Icon name="campaign" size={22} className="text-primary" />
          MKT Hub
        </MktLink>
        <div className="flex items-center gap-2">
          <Link
            href={ONEBIZ_URL}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-outline-variant bg-background px-3 text-sm font-medium hover:bg-surface-container"
          >
            <Icon name="grid_view" size={18} />
            <span className="hidden sm:inline">OneBiz ERP</span>
          </Link>
          <MktUserMenu />
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <MktNav ctx={ctx} />
        <main className="min-w-0 flex-1 pb-20 lg:pb-0">{children}</main>
      </div>
      </div>
    </MktRoutingProvider>
  );
}
