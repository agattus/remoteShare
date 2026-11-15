import { Apple, Check, Download, Monitor, Terminal } from "lucide-react";
import { Logo } from "@/components/Logo";
import { DOWNLOADS, detectPlatform, downloadUrl, releasesPageUrl, type Platform } from "@/lib/downloads";

type Known = Exclude<Platform, "other">;

function WindowsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M3 5.5 10.5 4.5v6.8H3V5.5Zm8.7-1.1L21 3v8.3h-9.3V4.4ZM3 12.7h7.5v6.8L3 18.5v-5.8Zm8.7 0H21V21l-9.3-1.3v-7Z" />
    </svg>
  );
}

const OS: Record<Known, { name: string; icon: React.ComponentType<{ className?: string }>; requirement: string }> = {
  windows: { name: "Windows", icon: WindowsIcon, requirement: "Windows 10 or 11" },
  mac: { name: "macOS", icon: Apple, requirement: "macOS 12 or newer" },
  linux: { name: "Linux", icon: Terminal, requirement: "Ubuntu, Debian, Fedora and more" },
};

function AppPreview() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-sm select-none">
      <div className="absolute -inset-6 -z-10 rounded-full bg-[radial-gradient(closest-side,oklch(0.62_0.17_235/0.35),transparent)] blur-xl" />
      <div className="overflow-hidden rounded-xl border border-white/10 bg-[oklch(0.18_0.025_255)] shadow-[0_30px_60px_-20px_oklch(0_0_0/0.8)]">
        <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 flex items-center gap-1.5 text-[0.7rem] text-muted-foreground">
            <Logo className="size-3.5" /> Tethera
          </span>
        </div>
        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Allow remote access</span>
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[0.65rem] text-emerald-300">
              <span className="size-1.5 animate-pulse rounded-full bg-current" /> Ready
            </span>
          </div>
          <div>
            <p className="mb-1 text-[0.65rem] text-muted-foreground">Your Device ID</p>
            <div className="text-gradient rounded-lg border bg-black/25 px-3 py-2 font-mono text-xl font-semibold tracking-[0.16em]">482 913 057</div>
          </div>
          <div>
            <p className="mb-1 text-[0.65rem] text-muted-foreground">Password</p>
            <div className="rounded-lg border bg-black/25 px-3 py-1.5 font-mono text-sm text-muted-foreground">••••••••••</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DownloadApp() {
  const detected = detectPlatform();
  const primary: Known = detected === "other" ? "windows" : detected;
  const options = DOWNLOADS[primary];
  const PrimaryIcon = OS[primary].icon;
  const others = (Object.keys(DOWNLOADS) as Known[]).filter((p) => p !== primary);

  return (
    <section
      aria-labelledby="download-title"
      className="glass animate-float-in relative overflow-hidden rounded-3xl p-6 sm:p-8"
      style={{ animationDelay: "140ms" }}
    >
      <div className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-[radial-gradient(closest-side,oklch(0.65_0.15_215/0.35),transparent)]" />
      <div className="relative grid items-center gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12">
        <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Logo className="size-14 shrink-0 drop-shadow-[0_10px_20px_oklch(0.62_0.17_235/0.5)]" />
          <div>
            <h2 id="download-title" className="text-xl font-semibold tracking-tight">
              Get the Tethera app
            </h2>
            <p className="text-sm text-muted-foreground">Install it on the computer you want to reach. It stays ready in your system tray.</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            {options.map((option, index) => (
              <a
                key={option.id}
                href={downloadUrl(option.file)}
                download
                className={`group flex flex-1 items-center gap-3 rounded-xl px-4 py-3 text-left transition-all focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none ${
                  index === 0
                    ? "bg-gradient-to-b from-[oklch(0.76_0.13_200)] to-[oklch(0.56_0.2_262)] text-white shadow-[0_12px_30px_-10px_oklch(0.62_0.17_235/0.9),inset_0_1px_0_oklch(1_0_0/0.25)] hover:brightness-110"
                    : "border border-white/10 bg-white/5 hover:bg-white/10"
                }`}
              >
                <PrimaryIcon className="size-6 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">Download for {option.label.replace(/ \(.*\)/, "")}</span>
                  <span className={`block truncate text-xs ${index === 0 ? "text-white/75" : "text-muted-foreground"}`}>
                    {option.label.includes("(") ? option.label.match(/\((.*)\)/)?.[1] : OS[primary].requirement}
                  </span>
                </span>
                <Download className="size-4 shrink-0 opacity-80 transition-transform group-hover:translate-y-0.5" />
              </a>
            ))}
          </div>

          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {["Free forever", "No account needed", "Encrypted peer-to-peer"].map((item) => (
              <li key={item} className="flex items-center gap-1">
                <Check className="size-3.5 text-success" /> {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t border-white/10 pt-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Monitor className="size-3.5" /> Also available for
          </p>
          <div className="flex flex-wrap gap-2">
            {others.flatMap((os) =>
              DOWNLOADS[os].map((option) => {
                const Icon = OS[os].icon;
                return (
                  <a
                    key={option.id}
                    href={downloadUrl(option.file)}
                    download
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs transition-colors hover:bg-white/10"
                  >
                    <Icon className="size-3.5" /> {option.label}
                  </a>
                );
              }),
            )}
            {detected === "other" && (
              <a className="text-xs underline underline-offset-2" href={releasesPageUrl} target="_blank" rel="noreferrer">
                All downloads
              </a>
            )}
          </div>
          <p className="mt-3 text-xs text-muted-foreground/80">
            Not code-signed yet, so Windows or macOS may warn on first launch. Windows: <em>More info, Run anyway</em>. macOS: right-click the app, then{" "}
            <em>Open</em>.
          </p>
        </div>
        </div>
        <AppPreview />
      </div>
    </section>
  );
}
