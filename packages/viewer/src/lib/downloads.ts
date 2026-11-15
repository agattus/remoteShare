const RELEASES = (import.meta.env.VITE_RELEASES_URL as string | undefined) ?? "https://github.com/agattus/remoteShare/releases/latest";

export type Platform = "windows" | "mac" | "linux" | "other";

export interface DownloadOption {
  id: string;
  label: string;
  file: string;
  hint: string;
}

export const DOWNLOADS: Record<Exclude<Platform, "other">, DownloadOption[]> = {
  windows: [{ id: "win", label: "Windows", file: "Tethera-Setup.exe", hint: "Windows 10 or 11" }],
  mac: [
    { id: "mac-arm64", label: "macOS (Apple silicon)", file: "Tethera-arm64.dmg", hint: "M1, M2, M3 and newer" },
    { id: "mac-x64", label: "macOS (Intel)", file: "Tethera-x64.dmg", hint: "Older Intel Macs" },
  ],
  linux: [
    { id: "linux-appimage", label: "Linux (AppImage)", file: "Tethera.AppImage", hint: "Runs on most distributions" },
    { id: "linux-deb", label: "Linux (.deb)", file: "Tethera.deb", hint: "Debian, Ubuntu" },
  ],
};

export function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("windows")) return "windows";
  if (ua.includes("mac") && !ua.includes("iphone") && !ua.includes("ipad")) return "mac";
  if (ua.includes("linux") && !ua.includes("android")) return "linux";
  return "other";
}

export function downloadUrl(file: string): string {
  return `${RELEASES.replace(/\/+$/, "")}/download/${file}`;
}

export const releasesPageUrl = RELEASES;
