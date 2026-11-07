import { desktopCapturer, screen, type Display, type DesktopCapturerSource } from "electron";
import type { ScreenInfo } from "@remotedesk/shared";

let selectedId: string | null = null;

function displays(): Display[] {
  return screen.getAllDisplays();
}

export function getSelectedDisplay(): Display {
  const all = displays();
  return all.find((d) => String(d.id) === selectedId) ?? screen.getPrimaryDisplay();
}

export function listScreens(): { screens: ScreenInfo[]; selected: string } {
  const primary = screen.getPrimaryDisplay().id;
  const all = displays();
  const infos = all.map((d, index) => ({
    id: String(d.id),
    name: all.length > 1 ? `Display ${index + 1}${d.id === primary ? " (main)" : ""}` : "Main display",
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor),
    primary: d.id === primary,
  }));
  return { screens: infos, selected: String(getSelectedDisplay().id) };
}

export function selectScreen(id: string): void {
  if (displays().some((d) => String(d.id) === id)) selectedId = id;
}

export async function pickCaptureSource(): Promise<DesktopCapturerSource | undefined> {
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
  const display = getSelectedDisplay();
  const byId = sources.find((s) => s.display_id === String(display.id));
  if (byId) return byId;
  const index = displays().findIndex((d) => d.id === display.id);
  return sources[index] ?? sources[0];
}
