import { useState } from "react";
import { AlertTriangle, Check, Copy, Eye, EyeOff, Monitor, RefreshCw, ShieldAlert, Unplug, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { formatDeviceId, MIN_PASSWORD_LENGTH } from "@remotedesk/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { generatePassword, type HostController } from "@/lib/hostController";
import { desktop, type PermissionStatus } from "@/lib/desktop";
import { useStore } from "@/lib/useStore";
import { useEffect } from "react";

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="outline"
      size="icon"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="text-success" /> : <Copy />}
    </Button>
  );
}

const STATUS_LABEL = {
  online: { text: "Ready for connections", className: "bg-emerald-500/15 text-emerald-300" },
  connecting: { text: "Connecting to server…", className: "bg-amber-500/15 text-amber-300" },
  error: { text: "Server unreachable", className: "bg-red-500/15 text-red-300" },
  offline: { text: "Offline", className: "bg-zinc-500/20 text-zinc-300" },
} as const;

export function HostPanel({ host }: { host: HostController }) {
  const { status, error, config, session, screens, selectedScreen } = useStore(host.store);
  const [showPassword, setShowPassword] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null);

  useEffect(() => {
    void desktop()?.getPermissions().then(setPermissions);
  }, [session?.phase]);

  if (!config) return null;
  const label = STATUS_LABEL[status];
  const savePassword = async () => {
    if (draft.length < MIN_PASSWORD_LENGTH) return toast.error(`Use at least ${MIN_PASSWORD_LENGTH} characters`);
    await host.updateConfig({ password: draft });
    setEditing(false);
    toast.success("Password updated");
  };

  const needsScreen = permissions && permissions.platform === "darwin" && permissions.screen !== "granted";
  const needsAccessibility = permissions && permissions.platform === "darwin" && !permissions.accessibility;
  const wayland = permissions?.sessionType === "wayland";

  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-xl">Allow remote access to this computer</CardTitle>
              <CardDescription className="mt-1.5">Share these details with the person (or the other device) that will connect.</CardDescription>
            </div>
            <Badge className={`shrink-0 ${label.className}`}>{label.text}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {error && status !== "online" && (
            <p role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-red-200">
              <AlertTriangle className="size-4 shrink-0" /> {error}
            </p>
          )}
          <div className="space-y-2">
            <Label>Your Device ID</Label>
            <div className="flex gap-2">
              <div
                data-testid="device-id"
                className="flex h-12 flex-1 items-center rounded-md border bg-secondary/40 px-4 font-mono text-2xl tracking-widest"
              >
                {config.deviceId ? formatDeviceId(config.deviceId) : "—"}
              </div>
              {config.deviceId && <CopyButton value={config.deviceId} label="device ID" />}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="host-password">Password</Label>
            {editing ? (
              <div className="flex gap-2">
                <Input
                  id="host-password"
                  autoFocus
                  value={draft}
                  maxLength={64}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void savePassword()}
                  placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                />
                <Button onClick={() => void savePassword()}>Save</Button>
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <div data-testid="host-password" className="flex h-10 flex-1 items-center rounded-md border bg-secondary/40 px-3 font-mono">
                  {showPassword ? config.password : "•".repeat(config.password.length)}
                </div>
                <Button variant="outline" size="icon" onClick={() => setShowPassword((s) => !s)} aria-label={showPassword ? "Hide password" : "Show password"}>
                  {showPassword ? <EyeOff /> : <Eye />}
                </Button>
                <CopyButton value={config.password} label="password" />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Generate a new password"
                  onClick={() => {
                    void host.updateConfig({ password: generatePassword() });
                    setShowPassword(true);
                  }}
                >
                  <RefreshCw />
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDraft("");
                    setEditing(true);
                  }}
                >
                  Change
                </Button>
              </div>
            )}
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border bg-secondary/30 p-4">
            <div className="space-y-1">
              <Label htmlFor="unattended" className="flex items-center gap-2">
                <UserCheck className="size-4" /> Unattended access
              </Label>
              <p className="text-sm text-muted-foreground">
                {config.unattended
                  ? "Anyone with the correct password connects immediately, without a prompt on this computer."
                  : "You will be asked to allow each connection, even with the correct password."}
              </p>
            </div>
            <Switch id="unattended" checked={config.unattended} onCheckedChange={(v) => void host.updateConfig({ unattended: v })} />
          </div>

          {screens.length > 1 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Monitor className="size-4" /> Shared monitor
              </Label>
              <Select value={selectedScreen ?? undefined} onValueChange={(id) => void host.chooseScreen(id)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a monitor" />
                </SelectTrigger>
                <SelectContent>
                  {screens.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.width}×{s.height})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {session && (
        <Card className="border-amber-400/40 bg-amber-500/5">
          <CardContent className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="relative flex size-3">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex size-3 rounded-full bg-amber-400" />
              </span>
              <div>
                <p className="font-medium" data-testid="session-banner">
                  {session.phase === "connected" ? `${session.viewerName} is controlling this computer` : `${session.viewerName} is connecting…`}
                </p>
                <p className="text-sm text-muted-foreground">You can end the session at any time.</p>
              </div>
            </div>
            <Button variant="destructive" onClick={() => host.endSession()}>
              <Unplug /> Disconnect
            </Button>
          </CardContent>
        </Card>
      )}

      {(needsScreen || needsAccessibility || wayland || (permissions && !permissions.inputAvailable)) && (
        <Card className="border-amber-400/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4 text-amber-400" /> Permissions needed
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            {needsScreen && (
              <div className="flex items-center justify-between gap-3">
                <span>Allow Screen Recording so remote viewers can see this computer.</span>
                <Button size="sm" variant="outline" onClick={() => void desktop()?.openPermissionSettings("screen")}>
                  Open settings
                </Button>
              </div>
            )}
            {needsAccessibility && (
              <div className="flex items-center justify-between gap-3">
                <span>Allow Accessibility so remote mouse and keyboard input works.</span>
                <Button size="sm" variant="outline" onClick={() => void desktop()?.openPermissionSettings("accessibility")}>
                  Open settings
                </Button>
              </div>
            )}
            {wayland && (
              <p>
                This is a Wayland session. Screen capture goes through a system prompt and remote input is limited. For full control, log in with an
                X11 session.
              </p>
            )}
            {permissions && !permissions.inputAvailable && !needsAccessibility && (
              <p>Remote input is unavailable on this computer, so viewers get a view-only session.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
