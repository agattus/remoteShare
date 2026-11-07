import { useState } from "react";
import { AlertTriangle, ArrowRight, Eye, EyeOff, Loader2, MonitorSmartphone, ShieldCheck, X } from "lucide-react";
import { formatDeviceId, normalizeDeviceId, DEVICE_ID_LENGTH } from "@remotedesk/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { forgetDevice, getRecentDevices } from "@/lib/settings";
import { useStore } from "@/lib/useStore";
import type { EndReason, ViewerSession, ViewerState } from "@/lib/viewerSession";

const END_MESSAGES: Record<EndReason, string> = {
  denied: "The person at that device declined the connection.",
  timeout: "Nobody approved the connection in time. Ask them to click Allow and try again.",
  "host-offline": "The remote device went offline.",
  "peer-left": "The remote device ended the session.",
  ended: "Session ended.",
  "connection-lost": "The connection was lost. Check both networks and try again.",
};

function statusFor(state: ViewerState): { busy: boolean; text: string } | null {
  switch (state.status) {
    case "signaling":
      return { busy: true, text: "Contacting the server…" };
    case "awaiting-consent":
      return { busy: true, text: "Waiting for the remote user to allow the connection…" };
    case "negotiating":
      return { busy: true, text: "Setting up a secure peer-to-peer connection…" };
    default:
      return null;
  }
}

export function ConnectPanel({ session }: { session: ViewerSession }) {
  const { state } = useStore(session.store);
  const [id, setId] = useState(() => formatDeviceId(getRecentDevices()[0] ?? ""));
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [recents, setRecents] = useState(getRecentDevices);

  const status = statusFor(state);
  const busy = status?.busy ?? false;
  const idValid = normalizeDeviceId(id).length === DEVICE_ID_LENGTH;
  const canSubmit = idValid && password.length > 0 && !busy;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    void session.connect(id, password);
    setRecents(getRecentDevices());
  };

  const message =
    state.status === "error"
      ? state.code === "rate-limited" && state.retryAfterSec
        ? `${state.message} (about ${Math.max(1, Math.ceil(state.retryAfterSec / 60))} min)`
        : state.message
      : state.status === "ended"
        ? END_MESSAGES[state.reason]
        : null;
  const isProblem = state.status === "error" || (state.status === "ended" && state.reason !== "ended" && state.reason !== "peer-left");

  return (
    <div className="mx-auto w-full max-w-md">
      <Card>
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <MonitorSmartphone className="size-5" />
          </div>
          <CardTitle className="text-xl">Control a remote computer</CardTitle>
          <CardDescription>Enter the Device ID and password shown in the RemoteDesk app on the other computer.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="device-id">Device ID</Label>
              <Input
                id="device-id"
                inputMode="numeric"
                autoComplete="off"
                placeholder="123 456 789"
                className="h-11 font-mono text-lg tracking-widest"
                value={id}
                disabled={busy}
                onChange={(e) => setId(formatDeviceId(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="device-password">Password</Label>
              <div className="relative">
                <Input
                  id="device-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="off"
                  className="h-11 pr-10"
                  placeholder="Device password"
                  value={password}
                  disabled={busy}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {status && (
              <div className="flex items-center gap-3 rounded-lg border bg-secondary/50 px-3 py-2.5 text-sm" role="status">
                <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                <span className="flex-1">{status.text}</span>
                <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => session.disconnect()} aria-label="Cancel">
                  <X />
                </Button>
              </div>
            )}

            {message && !status && (
              <div
                role="alert"
                className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm ${
                  isProblem ? "border-destructive/40 bg-destructive/10 text-red-200" : "bg-secondary/50 text-muted-foreground"
                }`}
              >
                {isProblem && <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
                <span>{message}</span>
              </div>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={!canSubmit}>
              {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />} Connect
            </Button>
          </form>

          {recents.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent devices</p>
              <div className="flex flex-wrap gap-2">
                {recents.map((r) => (
                  <span key={r} className="inline-flex items-center overflow-hidden rounded-md border bg-secondary/40 text-sm">
                    <button type="button" className="px-2.5 py-1 font-mono hover:bg-accent" onClick={() => setId(formatDeviceId(r))}>
                      {formatDeviceId(r)}
                    </button>
                    <button
                      type="button"
                      className="px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={`Forget ${formatDeviceId(r)}`}
                      onClick={() => {
                        forgetDevice(r);
                        setRecents(getRecentDevices());
                      }}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" /> Screen and input travel peer-to-peer, encrypted end to end.
      </p>
    </div>
  );
}
