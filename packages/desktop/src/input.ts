import { screen } from "electron";
import type { InputEvent } from "@remotedesk/shared";
import { getSelectedDisplay } from "./screens";

type NutModule = typeof import("@nut-tree-fork/nut-js");

let nut: NutModule | null = null;
let loadError: string | null = null;
let keyMap: Record<string, number> = {};

export function loadInputBackend(): void {
  try {
    nut = require("@nut-tree-fork/nut-js") as NutModule;
    nut.keyboard.config.autoDelayMs = 0;
    nut.mouse.config.autoDelayMs = 0;
    keyMap = buildKeyMap(nut.Key);
  } catch (err) {
    nut = null;
    loadError = err instanceof Error ? err.message : String(err);
    console.warn("Remote input backend unavailable:", loadError);
  }
}

export function isInputAvailable(): boolean {
  return nut !== null;
}

export function inputBackendError(): string | null {
  return loadError;
}

function buildKeyMap(Key: NutModule["Key"]): Record<string, number> {
  const k = Key as unknown as Record<string, number>;
  const map: Record<string, number> = {};
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") map[`Key${letter}`] = k[letter]!;
  for (let d = 0; d <= 9; d++) {
    map[`Digit${d}`] = k[`Num${d}`]!;
    map[`Numpad${d}`] = k[`NumPad${d}`]!;
  }
  for (let f = 1; f <= 24; f++) map[`F${f}`] = k[`F${f}`]!;
  const named: Record<string, string> = {
    Escape: "Escape",
    Backquote: "Grave",
    Minus: "Minus",
    Equal: "Equal",
    Backspace: "Backspace",
    Tab: "Tab",
    BracketLeft: "LeftBracket",
    BracketRight: "RightBracket",
    Backslash: "Backslash",
    IntlBackslash: "Backslash",
    CapsLock: "CapsLock",
    Semicolon: "Semicolon",
    Quote: "Quote",
    Enter: "Return",
    NumpadEnter: "Enter",
    ShiftLeft: "LeftShift",
    ShiftRight: "RightShift",
    ControlLeft: "LeftControl",
    ControlRight: "RightControl",
    AltLeft: "LeftAlt",
    AltRight: "RightAlt",
    MetaLeft: "LeftSuper",
    MetaRight: "RightSuper",
    Space: "Space",
    Comma: "Comma",
    Period: "Period",
    Slash: "Slash",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Insert: "Insert",
    Delete: "Delete",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    ContextMenu: "Menu",
    PrintScreen: "Print",
    ScrollLock: "ScrollLock",
    Pause: "Pause",
    NumLock: "NumLock",
    NumpadAdd: "Add",
    NumpadSubtract: "Subtract",
    NumpadMultiply: "Multiply",
    NumpadDivide: "Divide",
    NumpadDecimal: "Decimal",
  };
  for (const [code, name] of Object.entries(named)) {
    if (k[name] !== undefined) map[code] = k[name]!;
  }
  return map;
}

function targetPoint(nx: number, ny: number): { x: number; y: number } {
  const display = getSelectedDisplay();
  const dip = {
    x: Math.round(display.bounds.x + nx * (display.bounds.width - 1)),
    y: Math.round(display.bounds.y + ny * (display.bounds.height - 1)),
  };
  return process.platform === "win32" ? screen.dipToScreenPoint(dip) : dip;
}

async function apply(event: InputEvent): Promise<void> {
  if (!nut) return;
  const { mouse, keyboard, Button, Point } = nut;
  const buttons = [Button.LEFT, Button.MIDDLE, Button.RIGHT] as const;
  switch (event.t) {
    case "mousemove": {
      const p = targetPoint(event.x, event.y);
      await mouse.setPosition(new Point(p.x, p.y));
      break;
    }
    case "mousedown": {
      const p = targetPoint(event.x, event.y);
      await mouse.setPosition(new Point(p.x, p.y));
      await mouse.pressButton(buttons[event.button]);
      break;
    }
    case "mouseup": {
      const p = targetPoint(event.x, event.y);
      await mouse.setPosition(new Point(p.x, p.y));
      await mouse.releaseButton(buttons[event.button]);
      break;
    }
    case "wheel": {
      const vertical = Math.max(1, Math.round(Math.abs(event.dy) / 40));
      const horizontal = Math.max(1, Math.round(Math.abs(event.dx) / 40));
      if (Math.abs(event.dy) >= Math.abs(event.dx)) {
        if (event.dy > 0) await mouse.scrollDown(vertical);
        else if (event.dy < 0) await mouse.scrollUp(vertical);
      } else if (event.dx > 0) await mouse.scrollRight(horizontal);
      else await mouse.scrollLeft(horizontal);
      break;
    }
    case "keydown": {
      const key = keyMap[event.code];
      if (key !== undefined) await keyboard.pressKey(key);
      break;
    }
    case "keyup": {
      const key = keyMap[event.code];
      if (key !== undefined) await keyboard.releaseKey(key);
      break;
    }
  }
}

const queue: InputEvent[] = [];
let pumping = false;

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const next = queue.shift()!;
      try {
        await apply(next);
      } catch (err) {
        console.warn("Input injection failed:", err);
      }
    }
  } finally {
    pumping = false;
  }
}

/** Events run strictly in order; consecutive pending mouse moves collapse into the latest one. */
export function injectInput(event: InputEvent): void {
  if (!nut) return;
  const last = queue[queue.length - 1];
  if (event.t === "mousemove" && last?.t === "mousemove") queue[queue.length - 1] = event;
  else queue.push(event);
  void pump();
}

export function releaseAllInput(): void {
  queue.length = 0;
}
