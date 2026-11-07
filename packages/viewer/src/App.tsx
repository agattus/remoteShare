import { useEffect, useMemo, useState } from "react";
import { MonitorUp, Settings, Cast, Radio } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { ConnectPanel } from "@/components/ConnectPanel";
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
      <div className="mx-auto flex min-h-full max-w-5xl flex-col px-4 py-6 sm:px-6">
        <header className="mb-10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <MonitorUp className="size-5" />
            </div>
            <span className="text-lg font-semibold tracking-tight">RemoteDesk</span>
          </div>

          <div className="flex items-center gap-2">
            {desktopApp && (
              <nav className="flex rounded-lg border bg-secondary/40 p-1" aria-label="Mode">
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
          {tab === "host" && desktopApp ? <HostPanel host={host} /> : <ConnectPanel session={session} />}
        </main>
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
