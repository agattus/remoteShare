import { Download, Lock, MonitorSmartphone, Zap, type LucideIcon } from "lucide-react";

export function Hero({ desktopApp }: { desktopApp: boolean }) {
  return (
    <div className="animate-float-in mx-auto max-w-2xl text-center">
      <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
        <span className="size-1.5 rounded-full bg-success shadow-[0_0_8px_var(--success)]" />
        Free, private, peer-to-peer
      </span>
      <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        Your computer, <span className="text-gradient">from anywhere</span>
      </h1>
      <p className="mx-auto mt-4 max-w-xl text-base text-pretty text-muted-foreground sm:text-lg">
        {desktopApp
          ? "Share this computer with a Device ID and password, or connect to another one in a few seconds."
          : "See and control another computer right from your browser. No accounts, no time limits, nothing to configure."}
      </p>
    </div>
  );
}

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Download, title: "Install on the computer you want to reach", body: "Open Orbit there. It shows a Device ID and password." },
  { icon: MonitorSmartphone, title: "Enter them here", body: "Type the Device ID and password from any browser or the app." },
  { icon: Lock, title: "Approve and take control", body: "The other person (or you, if unattended) allows it, then your screen and keyboard connect directly." },
];

export function HowItWorks() {
  return (
    <section className="animate-float-in space-y-5" aria-labelledby="how-title" style={{ animationDelay: "80ms" }}>
      <h2 id="how-title" className="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        <Zap className="size-4 text-primary" /> How it works
      </h2>
      <ol className="space-y-4">
        {STEPS.map(({ icon: Icon, title, body }, index) => (
          <li key={title} className="flex gap-4">
            <div className="relative flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-b from-white/10 to-white/[0.02] text-primary">
              <Icon className="size-5" />
              <span className="absolute -top-1.5 -left-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-[0.65rem] font-bold text-white">
                {index + 1}
              </span>
            </div>
            <div>
              <h3 className="font-medium">{title}</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
