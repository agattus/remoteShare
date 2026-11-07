import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardCopy,
  ClipboardPaste,
  Command,
  Eye,
  Fullscreen,
  Gauge,
  Keyboard,
  Loader2,
  Maximize,
  Minimize,
  Monitor,
  MousePointer2,
  Paperclip,
  PhoneOff,
  Scan,
} from "lucide-react";
import { toast } from "sonner";
import type { QualityPreset } from "@remotedesk/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ViewerSession } from "@/lib/viewerSession";
import { useStore } from "@/lib/useStore";

const SPECIAL_KEYS: { label: string; codes: string[] }[] = [
  { label: "Ctrl + Alt + Del", codes: ["ControlLeft", "AltLeft", "Delete"] },
  { label: "Ctrl + Shift + Esc", codes: ["ControlLeft", "ShiftLeft", "Escape"] },
  { label: "Alt + Tab", codes: ["AltLeft", "Tab"] },
  { label: "Windows / Command key", codes: ["MetaLeft"] },
  { label: "Escape", codes: ["Escape"] },
  { label: "Print Screen", codes: ["PrintScreen"] },
];

function contentRect(video: HTMLVideoElement) {
  const box = video.getBoundingClientRect();
  const vw = video.videoWidth || box.width;
  const vh = video.videoHeight || box.height;
  const scale = Math.min(box.width / vw, box.height / vh);
  const width = vw * scale;
  const height = vh * scale;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}

export function RemoteScreen({ session }: { session: ViewerSession }) {
  const snapshot = useStore(session.store);
  const { stream, state, unstable, screens, selectedScreen, quality, stats, inputDisabledReason, transfer } = snapshot;
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pressed = useRef(new Set<string>());
  const pendingMove = useRef<{ x: number; y: number } | null>(null);
  const [fit, setFit] = useState(true);
  const [viewOnly, setViewOnly] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [hasFrame, setHasFrame] = useState(false);
  const inputEnabled = !viewOnly && !inputDisabledReason && state.status === "connected";

  useEffect(() => {
    const video = videoRef.current;
    if (video && video.srcObject !== stream) video.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (transfer?.status === "done") toast.success(`Sent ${transfer.name}`, { description: "Saved to the remote Downloads folder." });
    if (transfer?.status === "error") toast.error(`Could not send ${transfer.name}`, { description: transfer.message });
  }, [transfer?.status, transfer?.name, transfer?.message]);

  const toNormalized = useCallback((clientX: number, clientY: number) => {
    const video = videoRef.current;
    if (!video) return null;
    const rect = contentRect(video);
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  }, []);

  useEffect(() => {
    let frame = 0;
    const flush = () => {
      frame = 0;
      const move = pendingMove.current;
      if (move) {
        session.sendInput({ t: "mousemove", ...move });
        pendingMove.current = null;
      }
    };
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!inputEnabled) return;
      event.preventDefault();
      const scale = event.deltaMode === 1 ? 40 : 1;
      session.sendInput({ t: "wheel", dx: event.deltaX * scale, dy: event.deltaY * scale });
    };
    const onMove = (event: PointerEvent) => {
      if (!inputEnabled) return;
      const p = toNormalized(event.clientX, event.clientY);
      if (!p) return;
      pendingMove.current = p;
      if (!frame) frame = requestAnimationFrame(flush);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointermove", onMove);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [inputEnabled, session, toNormalized]);

  const releaseKeys = useCallback(() => {
    pressed.current.forEach((code) => session.sendInput({ t: "keyup", code }));
    pressed.current.clear();
  }, [session]);

  useEffect(() => () => releaseKeys(), [releaseKeys]);

  const onMouse = (type: "mousedown" | "mouseup") => (event: React.PointerEvent) => {
    if (!inputEnabled) return;
    containerRef.current?.focus();
    const p = toNormalized(event.clientX, event.clientY);
    if (!p || event.button > 2) return;
    event.preventDefault();
    if (type === "mousedown") (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    session.sendInput({ t: type, ...p, button: event.button as 0 | 1 | 2 });
  };

  const onKey = (type: "keydown" | "keyup") => (event: React.KeyboardEvent) => {
    if (!inputEnabled) return;
    event.preventDefault();
    event.stopPropagation();
    if (type === "keydown") pressed.current.add(event.code);
    else pressed.current.delete(event.code);
    session.sendInput({ t: type, code: event.code });
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await document.documentElement.requestFullscreen();
    const keyboard = (navigator as Navigator & { keyboard?: { lock?: (keys?: string[]) => Promise<void> } }).keyboard;
    keyboard?.lock?.().catch(() => {});
    containerRef.current?.focus();
  };

  const sendSpecial = (codes: string[]) => {
    codes.forEach((code) => session.sendInput({ t: "keydown", code }));
    [...codes].reverse().forEach((code) => session.sendInput({ t: "keyup", code }));
  };

  const pasteToRemote = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return toast.info("Your clipboard is empty");
      session.pasteToRemote(text);
      toast.success("Clipboard sent", { description: "Paste on the remote device with Ctrl/Cmd + V." });
    } catch {
      toast.error("Clipboard access was blocked by the browser");
    }
  };

  const copyFromRemote = async () => {
    try {
      const text = await session.copyFromRemote();
      await navigator.clipboard.writeText(text);
      toast.success("Remote clipboard copied to this device");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read the remote clipboard");
    }
  };

  const connecting = state.status !== "connected" || !hasFrame;
  const statLine = useMemo(() => {
    const parts: string[] = [];
    if (stats.rttMs !== undefined) parts.push(`${stats.rttMs} ms`);
    if (stats.fps !== undefined) parts.push(`${stats.fps} fps`);
    if (stats.kbps !== undefined && stats.kbps > 0) parts.push(`${(stats.kbps / 1000).toFixed(1)} Mbps`);
    return parts.join(" · ");
  }, [stats]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black">
      <div
        ref={containerRef}
        tabIndex={0}
        role="application"
        aria-label="Remote screen"
        className={`relative min-h-0 flex-1 outline-none ${fit ? "overflow-hidden" : "overflow-auto"} ${inputEnabled ? "cursor-crosshair" : ""}`}
        onPointerDown={onMouse("mousedown")}
        onPointerUp={onMouse("mouseup")}
        onContextMenu={(e) => inputEnabled && e.preventDefault()}
        onKeyDown={onKey("keydown")}
        onKeyUp={onKey("keyup")}
        onBlur={releaseKeys}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onPlaying={() => setHasFrame(true)}
          className={fit ? "h-full w-full object-contain" : "max-w-none"}
          style={fit ? undefined : { width: videoRef.current?.videoWidth || undefined }}
        />
        {connecting && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="size-8 animate-spin" />
            <p className="text-sm">Establishing a secure connection…</p>
          </div>
        )}
        {unstable && (
          <div className="absolute inset-x-0 top-16 mx-auto w-fit rounded-full bg-amber-500/90 px-4 py-1.5 text-sm font-medium text-black">
            Connection unstable, trying to recover…
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-3">
        <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1 rounded-xl border border-white/10 bg-zinc-900/90 p-1.5 shadow-xl backdrop-blur">
          <Badge variant="secondary" className="mx-1 gap-1.5 font-mono text-xs" title="Round trip, frame rate and bitrate">
            <span className={`size-2 rounded-full ${unstable ? "bg-amber-400" : "bg-emerald-400"}`} />
            {statLine || "Live"}
          </Badge>

          {screens.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" aria-label="Choose monitor">
                  <Monitor /> <span className="hidden sm:inline">Monitor</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Remote monitor</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={selectedScreen ?? ""} onValueChange={(id) => session.selectScreen(id)}>
                  {screens.map((s) => (
                    <DropdownMenuRadioItem key={s.id} value={s.id}>
                      {s.name} ({s.width}×{s.height})
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Stream quality">
                <Gauge /> <span className="hidden sm:inline capitalize">{quality}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Quality</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={quality} onValueChange={(v) => session.setQuality(v as QualityPreset)}>
                <DropdownMenuRadioItem value="low">Low (15 fps, saves data)</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="balanced">Balanced (30 fps)</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="high">High (60 fps, sharp)</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="ghost" size="sm" onClick={() => setFit((f) => !f)} aria-pressed={!fit}>
            {fit ? <Scan /> : <Fullscreen />} <span className="hidden sm:inline">{fit ? "Fit" : "100%"}</span>
          </Button>

          <Button
            variant={viewOnly || inputDisabledReason ? "secondary" : "ghost"}
            size="sm"
            disabled={!!inputDisabledReason}
            title={inputDisabledReason ?? "Toggle view-only mode"}
            onClick={() => setViewOnly((v) => !v)}
            aria-pressed={viewOnly}
          >
            {viewOnly || inputDisabledReason ? <Eye /> : <MousePointer2 />}
            <span className="hidden sm:inline">{viewOnly || inputDisabledReason ? "View only" : "Control"}</span>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Keyboard shortcuts">
                <Keyboard /> <span className="hidden sm:inline">Keys</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Send key combination</DropdownMenuLabel>
              {SPECIAL_KEYS.map((k) => (
                <DropdownMenuItem key={k.label} disabled={!inputEnabled} onSelect={() => sendSpecial(k.codes)}>
                  <Command /> {k.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Clipboard and files">
                <ClipboardPaste /> <span className="hidden sm:inline">Share</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={pasteToRemote}>
                <ClipboardPaste /> Send my clipboard
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={copyFromRemote}>
                <ClipboardCopy /> Get remote clipboard
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => fileInput.current?.click()}>
                <Paperclip /> Send a file…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void session.sendFile(file);
              e.target.value = "";
            }}
          />

          <Button variant="ghost" size="icon" className="size-8" onClick={toggleFullscreen} aria-label="Toggle fullscreen">
            {fullscreen ? <Minimize /> : <Maximize />}
          </Button>
          <Button variant="destructive" size="sm" onClick={() => session.disconnect()}>
            <PhoneOff /> <span className="hidden sm:inline">Disconnect</span>
          </Button>
        </div>
      </div>

      {inputDisabledReason && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-zinc-900/90 px-4 py-1.5 text-sm text-muted-foreground">
          {inputDisabledReason}
        </div>
      )}
      {transfer?.status === "sending" && (
        <div className="absolute bottom-4 right-4 w-72 rounded-lg border border-white/10 bg-zinc-900/95 p-3 shadow-xl">
          <p className="mb-2 truncate text-sm">Sending {transfer.name}</p>
          <Progress value={transfer.progress * 100} />
        </div>
      )}
    </div>
  );
}
