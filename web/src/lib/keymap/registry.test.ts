import { describe, expect, it } from "vitest";

import type { KeyBinding } from "./types";
import {
  getShortcutGroups,
  KEYMAP_COMMANDS,
  KEYMAP_COMMAND_IDS,
  PINNED_HOTKEY_CODES,
  PINNED_HOTKEY_DIGITS,
  resolveCommandDefaultBinding,
} from "./index";

describe("KEYMAP_COMMANDS registry", () => {
  it("defines a command for every id", () => {
    for (const id of KEYMAP_COMMAND_IDS) {
      expect(KEYMAP_COMMANDS[id].id).toBe(id);
    }
  });

  it("exposes ten pinned-session digits in tab order", () => {
    expect(PINNED_HOTKEY_DIGITS).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]);
    expect(PINNED_HOTKEY_CODES).toHaveLength(10);
  });

  it("uses plain Cmd+digit in the native shell", () => {
    const binding = resolveCommandDefaultBinding(
      KEYMAP_COMMANDS["jump-pinned-session"].defaultBinding,
      true,
    );
    expect(binding.keys).toEqual(PINNED_HOTKEY_DIGITS);
    expect(binding.alt).toBe("forbidden");
  });

  it("uses Cmd+Alt+Digit codes in the browser", () => {
    const binding = resolveCommandDefaultBinding(
      KEYMAP_COMMANDS["jump-pinned-session"].defaultBinding,
      false,
    );
    expect(binding.codes).toEqual(PINNED_HOTKEY_CODES);
    expect(binding.alt).toBe("required");
    expect(binding.rejectAltGraph).toBe(true);
  });
});

describe("getShortcutGroups", () => {
  it("lists one row per shipped shortcut group", () => {
    const groups = getShortcutGroups(false);
    expect(groups.map((g) => g.title)).toEqual([
      "General",
      "In chats",
      "Navigation",
      "View",
      "Slash commands",
    ]);
    expect(groups[0]?.items.map((i) => i.label)).toEqual([
      "Open command palette",
      "Show keyboard shortcuts",
    ]);
    expect(groups[4]?.note).toContain("suggestions menu");
  });

  it("shows Alt in the browser pinned-session chord", () => {
    const nav = getShortcutGroups(false).find((g) => g.title === "Navigation");
    const pinned = nav?.items.find((i) => i.label.includes("pinned session"));
    expect(pinned?.keys).toContain("Alt");
  });

  it("omits Alt from the native pinned-session chord", () => {
    const nav = getShortcutGroups(true).find((g) => g.title === "Navigation");
    const pinned = nav?.items.find((i) => i.label.includes("pinned session"));
    expect(pinned?.keys).not.toContain("Alt");
    expect(pinned?.keys).toContain("1…0");
  });

  it("uses modifier-agnostic bindings for the mention menu", () => {
    const up = KEYMAP_COMMANDS["mention-navigate-up"].defaultBinding as KeyBinding;
    const slashUp = KEYMAP_COMMANDS["slash-navigate-up"].defaultBinding as KeyBinding;
    expect(up.mod).toBeUndefined();
    expect(slashUp.mod).toBe("forbidden");
  });
});
