import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearKeymapOverrides,
  getEffectiveBinding,
  KEYMAP_COMMANDS,
  matchesBinding,
  matchesCommand,
  pinnedSessionIndexFromEvent,
  readKeymapOverrides,
  writeKeymapOverride,
} from "./index";

const isNativeShell = vi.fn(() => true);
vi.mock("@/lib/nativeBridge", () => ({
  isNativeShell: () => isNativeShell(),
}));

afterEach(() => {
  clearKeymapOverrides();
  isNativeShell.mockReturnValue(true);
});

function keydown(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
}

describe("matchesBinding", () => {
  it("matches Cmd/Ctrl+K for the command palette default", () => {
    const binding = KEYMAP_COMMANDS["command-palette"].defaultBinding;
    expect(matchesBinding(keydown({ key: "k", metaKey: true }), binding as never)).toBe(true);
    expect(matchesBinding(keydown({ key: "k", ctrlKey: true }), binding as never)).toBe(true);
    expect(matchesBinding(keydown({ key: "K", metaKey: true }), binding as never)).toBe(true);
  });

  it("rejects modifier variants that the binding forbids", () => {
    const binding = KEYMAP_COMMANDS["command-palette"].defaultBinding;
    expect(
      matchesBinding(keydown({ key: "k", metaKey: true, altKey: true }), binding as never),
    ).toBe(false);
    expect(
      matchesBinding(keydown({ key: "k", metaKey: true, shiftKey: true }), binding as never),
    ).toBe(false);
    expect(matchesBinding(keydown({ key: "k" }), binding as never)).toBe(false);
  });

  it("matches physical bracket codes for sidebar toggles", () => {
    const left = getEffectiveBinding("toggle-conversations-sidebar");
    expect(
      matchesBinding(keydown({ code: "BracketLeft", ctrlKey: true, altKey: true }), left),
    ).toBe(true);
    expect(matchesBinding(keydown({ code: "BracketLeft", ctrlKey: true }), left)).toBe(false);
  });

  it("ignores AltGraph when rejectAltGraph is set", () => {
    const binding = getEffectiveBinding("toggle-conversations-sidebar");
    const altGraph = vi
      .spyOn(KeyboardEvent.prototype, "getModifierState")
      .mockImplementation((keyArg) => keyArg === "AltGraph");
    expect(
      matchesBinding(keydown({ code: "BracketLeft", ctrlKey: true, altKey: true }), binding),
    ).toBe(false);
    altGraph.mockRestore();
  });

  it("rejects AltGraph for command palette even without alt required", () => {
    const binding = getEffectiveBinding("command-palette");
    const altGraph = vi
      .spyOn(KeyboardEvent.prototype, "getModifierState")
      .mockImplementation((keyArg) => keyArg === "AltGraph");
    expect(matchesBinding(keydown({ key: "k", ctrlKey: true }), binding)).toBe(false);
    altGraph.mockRestore();
  });
});

describe("mention-menu bindings", () => {
  it("match modified arrow keys (modifier-agnostic)", () => {
    expect(matchesCommand("mention-navigate-down", keydown({ key: "ArrowDown" }))).toBe(true);
    expect(
      matchesCommand("mention-navigate-down", keydown({ key: "ArrowDown", metaKey: true })),
    ).toBe(true);
    expect(
      matchesCommand(
        "mention-navigate-up",
        keydown({ key: "ArrowUp", ctrlKey: true, altKey: true }),
      ),
    ).toBe(true);
  });

  it("still forbids modifiers for slash-menu defaults", () => {
    expect(matchesCommand("slash-navigate-down", keydown({ key: "ArrowDown" }))).toBe(true);
    expect(
      matchesCommand("slash-navigate-down", keydown({ key: "ArrowDown", metaKey: true })),
    ).toBe(false);
  });
});

describe("matchesCommand", () => {
  it("resolves accept-approval from the registry", () => {
    expect(matchesCommand("accept-approval", keydown({ key: "Enter", metaKey: true }))).toBe(true);
    expect(matchesCommand("accept-approval", keydown({ key: "Enter" }))).toBe(false);
  });

  it("applies a stored override", () => {
    writeKeymapOverride("accept-approval", {
      mod: "required",
      alt: "forbidden",
      shift: "forbidden",
      key: "a",
    });
    expect(matchesCommand("accept-approval", keydown({ key: "a", metaKey: true }))).toBe(true);
    expect(matchesCommand("accept-approval", keydown({ key: "Enter", metaKey: true }))).toBe(false);
    expect(readKeymapOverrides()["accept-approval"]?.key).toBe("a");
  });
});

describe("pinnedSessionIndexFromEvent", () => {
  it("maps native Cmd+digit to index", () => {
    isNativeShell.mockReturnValue(true);
    expect(pinnedSessionIndexFromEvent(keydown({ key: "1", metaKey: true }))).toBe(0);
    expect(pinnedSessionIndexFromEvent(keydown({ key: "0", metaKey: true }))).toBe(9);
  });

  it("maps browser Cmd+Alt+Digit to index via code", () => {
    isNativeShell.mockReturnValue(false);
    expect(
      pinnedSessionIndexFromEvent(
        keydown({ key: "¡", metaKey: true, altKey: true, code: "Digit1" }),
      ),
    ).toBe(0);
    expect(pinnedSessionIndexFromEvent(keydown({ key: "1", metaKey: true, code: "Digit1" }))).toBe(
      -1,
    );
  });
});
