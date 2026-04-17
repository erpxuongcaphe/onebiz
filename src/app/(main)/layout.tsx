import { TopNav } from "@/components/shared/top-nav";
import { AppSidebar } from "@/components/shared/app-sidebar";
import { CommandPaletteProvider } from "@/components/shared/command-palette";
import { MobileBottomNav } from "@/components/shared/mobile-bottom-nav";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CommandPaletteProvider>
      <TopNav />
      {/*
        Cap chiều cao = viewport - TopNav (h-16 = 64px = 4rem) để:
        1. Sidebar nav scroll internal (không phình ra ngoài)
        2. "Hệ thống" pinned bottom luôn bám đáy viewport
      */}
      <div className="flex h-[calc(100vh-4rem)] min-h-0">
        <AppSidebar />
        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-auto">
          {children}
        </main>
      </div>
      <MobileBottomNav />
    </CommandPaletteProvider>
  );
}
