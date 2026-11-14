import { useEffect, useMemo, useState } from "react";
import { Settings, Cast, Radio, ShieldCheck } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { ConnectPanel } from "@/components/ConnectPanel";
import { DownloadApp } from "@/components/DownloadApp";
import { Logo } from "@/components/Logo";
import { Hero, HowItWorks } from "@/components/Landing";
import { HostPanel } from "@/components/HostPanel";
import { RemoteScreen } from "@/components/RemoteScreen";
import { SettingsDialog } from "@/components/SettingsDialog";
import { isDesktopApp } from "@/lib/desktop";
import { HostController } from "@/lib/hostController";
import { useStore } from "@/lib/useStore";
import { ViewerSession } from "@/lib/viewerSession";

type Tab = "connect" | "host";

export function App() {
  const desktopApp = isDesktopApp();
  const session = useMemo(() => new ViewerSession(), []);
  const host = useMemo(() => new HostController(), []);
  const [tab, setTab] = useState<Tab>(desktopApp ? "host" : "connect");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { state } = useStore(session.store);
  const hostState = useStore(host.store);

  useEffect(() => {
    if (!desktopApp) return;
    void host.start();
    return () => host.stop();
  }, [desktopApp, host]);

  useEffect(() => () => session.dispose(), [session]);

  const inSession = state.status === "connected" || (state.status === "negotiating" && session.store.get().stream !== null);

  return (
    <TooltipProvider>
      {inSession && <RemoteScreen session={session} />}
      <div className="mx-auto flex min-h-full max-w-5xl flex-col px-4 py-5 sm:px-6">
        <header className="mb-8 flex items-center justify-between gap-4 sm:mb-12">
          <div className="flex items-center gap-2.5">
            <Logo className="size-9 drop-shadow-[0_6px_16px_oklch(0.6_0.22_285/0.6)]" />
            <span className="text-lg font-semibold tracking-tight">Orbit</span>
          </div>

          <div className="flex items-center gap-2">
            {desktopApp && (
              <nav className="glass flex rounded-xl p-1" aria-label="Mode">
                <Button variant={tab === "host" ? "secondary" : "ghost"} size="sm" onClick={() => setTab("host")}>
                  <Radio /> This computer
                  {hostState.session && <span className="size-2 rounded-full bg-amber-400" />}
                </Button>
                <Button variant={tab === "connect" ? "secondary" : "ghost"} size="sm" onClick={() => setTab("connect")}>
                  <Cast /> Connect
                </Button>
              </nav>
            )}
            <Button variant="ghost" size="icon" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
              <Settings />
            </Button>
          </div>
        </header>

        <main className="flex-1">
          {tab === "host" && desktopApp ? (
            <HostPanel host={host} onOpenSettings={() => setSettingsOpen(true)} />
          ) : (
            <div className="space-y-10">
              <Hero desktopApp={desktopApp} />
              <div className={`grid items-start gap-6 ${desktopApp ? "mx-auto max-w-md" : "lg:grid-cols-2 lg:gap-10"}`}>
                <ConnectPanel session={session} />
                {!desktopApp && (
                  <div className="lg:pt-2">
                    <HowItWorks />
                  </div>
                )}
              </div>
              {!desktopApp && <DownloadApp />}
            </div>
          )}
        </main>

        <footer className="mt-12 flex items-center justify-center gap-1.5 pt-4 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" /> Screen and input travel directly between the two computers, encrypted end to end.
        </footer>
      </div>

      {settingsOpen && (
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onServerChanged={(url) => {
            if (desktopApp) {
              void host.updateConfig({ serverUrl: url }).then(() => host.restart());
            }
          }}
        />
      )}
      <Toaster position="bottom-center" />
    </TooltipProvider>
  );
}
