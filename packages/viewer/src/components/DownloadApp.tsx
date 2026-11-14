import { Download, Laptop } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DOWNLOADS, detectPlatform, downloadUrl, releasesPageUrl, type Platform } from "@/lib/downloads";

const PLATFORM_NAMES: Record<Platform, string> = {
  windows: "Windows",
  mac: "macOS",
  linux: "Linux",
  other: "your computer",
};

export function DownloadApp() {
  const platform = detectPlatform();
  const primary = platform === "other" ? [] : DOWNLOADS[platform];
  const others = (Object.keys(DOWNLOADS) as (keyof typeof DOWNLOADS)[]).filter((p) => p !== platform);

  return (
    <Card className="gap-0 py-5">
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
            <Laptop className="size-5" />
          </div>
          <div>
            <h2 className="font-semibold">Want to control a computer? Install RemoteDesk on it.</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              A web page cannot move another computer's mouse. Install the app on the computer you want to reach, open it, and it shows the Device ID
              and password to enter above.
            </p>
          </div>
        </div>

        {primary.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {primary.map((option, index) => (
              <Button key={option.id} asChild variant={index === 0 ? "default" : "outline"}>
                <a href={downloadUrl(option.file)} download>
                  <Download /> Download for {option.label}
                </a>
              </Button>
            ))}
          </div>
        )}
        {primary.length === 0 && (
          <Button asChild>
            <a href={releasesPageUrl} target="_blank" rel="noreferrer">
              <Download /> See downloads for {PLATFORM_NAMES[platform]}
            </a>
          </Button>
        )}

        <p className="text-xs text-muted-foreground">
          Other systems:{" "}
          {others.map((p, i) => (
            <span key={p}>
              {i > 0 && ", "}
              {DOWNLOADS[p].map((option, j) => (
                <span key={option.id}>
                  {j > 0 && ", "}
                  <a className="underline underline-offset-2 hover:text-foreground" href={downloadUrl(option.file)} download>
                    {option.label}
                  </a>
                </span>
              ))}
            </span>
          ))}
          . Installers are not code-signed yet, so Windows or macOS may warn on first launch: choose <em>More info, Run anyway</em> on Windows, or
          right-click and <em>Open</em> on macOS.
        </p>
      </CardContent>
    </Card>
  );
}
