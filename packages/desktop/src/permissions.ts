import { shell, systemPreferences } from "electron";
import { isInputAvailable } from "./input";

export interface PermissionStatus {
  platform: string;
  screen: "granted" | "denied" | "not-determined" | "restricted" | "unknown";
  accessibility: boolean;
  inputAvailable: boolean;
  sessionType?: string;
}

export function getPermissions(): PermissionStatus {
  const sessionType = process.platform === "linux" ? process.env.XDG_SESSION_TYPE : undefined;
  const wayland = sessionType === "wayland";
  if (process.platform === "darwin") {
    const accessibility = systemPreferences.isTrustedAccessibilityClient(false);
    return {
      platform: "darwin",
      screen: systemPreferences.getMediaAccessStatus("screen"),
      accessibility,
      inputAvailable: isInputAvailable() && accessibility,
    };
  }
  return {
    platform: process.platform,
    screen: "granted",
    accessibility: true,
    inputAvailable: isInputAvailable() && !wayland,
    sessionType,
  };
}

export async function openPermissionSettings(kind: "screen" | "accessibility"): Promise<void> {
  if (process.platform !== "darwin") return;
  if (kind === "accessibility") systemPreferences.isTrustedAccessibilityClient(true);
  const pane = kind === "screen" ? "Privacy_ScreenCapture" : "Privacy_Accessibility";
  await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
}
