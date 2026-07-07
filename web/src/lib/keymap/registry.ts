// Canonical registry of named keyboard commands — single source for defaults,
// shortcut-list display, and handler matching.

import type {
  KeyBinding,
  KeymapCommand,
  KeymapCommandId,
  KeymapDisplayContext,
  KeymapGroupId,
  KeymapShortcutGroup,
  PlatformKeyBinding,
} from "./types";
import { defaultDisplayContext } from "./platform";

/** Index → digit key (native path; matched against `e.key`). */
export const PINNED_HOTKEY_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

/** Index → physical key code (browser path; matched against `e.code`). */
export const PINNED_HOTKEY_CODES = [
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Digit6",
  "Digit7",
  "Digit8",
  "Digit9",
  "Digit0",
] as const;

const SLASH_NAV_UP: KeyBinding = { mod: "forbidden", alt: "forbidden", key: "ArrowUp" };
const SLASH_NAV_DOWN: KeyBinding = { mod: "forbidden", alt: "forbidden", key: "ArrowDown" };
const SLASH_APPLY: KeyBinding = { mod: "forbidden", alt: "forbidden", key: "Tab" };
const SLASH_DISMISS: KeyBinding = { mod: "forbidden", alt: "forbidden", key: "Escape" };

// Mention menu: match key identity regardless of held modifiers (pre-registry
// behavior). While the menu is open these keys must still consume modified
// chords so global hotkeys (e.g. Cmd+Arrow session switch) do not fire through.
const MENTION_NAV_UP: KeyBinding = { key: "ArrowUp" };
const MENTION_NAV_DOWN: KeyBinding = { key: "ArrowDown" };
const MENTION_APPLY: KeyBinding = { key: "Tab" };
const MENTION_DISMISS: KeyBinding = { key: "Escape" };

const GROUP_TITLES: Record<KeymapGroupId, string> = {
  general: "General",
  "in-chats": "In chats",
  navigation: "Navigation",
  view: "View",
  "slash-commands": "Slash commands",
};

const GROUP_NOTES: Partial<Record<KeymapGroupId, string>> = {
  "slash-commands": "while the suggestions menu is open",
};

/** Every command that ships today (mirrors KeyboardShortcutsDialog + mention menu). */
export const KEYMAP_COMMANDS: Record<KeymapCommandId, KeymapCommand> = {
  "command-palette": {
    id: "command-palette",
    label: "Open command palette",
    group: "general",
    scope: "global",
    defaultBinding: {
      mod: "required",
      alt: "forbidden",
      shift: "forbidden",
      key: "k",
      rejectAltGraph: true,
    },
    displayKeys: (ctx) => [ctx.modKey, "K"],
  },
  "show-keyboard-shortcuts": {
    id: "show-keyboard-shortcuts",
    label: "Show keyboard shortcuts",
    group: "general",
    scope: "global",
    defaultBinding: { mod: "required", alt: "forbidden", shift: "forbidden", key: "/" },
    displayKeys: (ctx) => [ctx.modKey, "/"],
  },
  "send-message": {
    id: "send-message",
    label: "Send message",
    group: "in-chats",
    scope: "composer",
    defaultBinding: { mod: "forbidden", alt: "forbidden", shift: "forbidden", key: "Enter" },
    displayKeys: (ctx) => [ctx.enterKey],
  },
  "new-line-in-message": {
    id: "new-line-in-message",
    label: "New line in message",
    group: "in-chats",
    scope: "composer",
    defaultBinding: { mod: "forbidden", alt: "forbidden", shift: "required", key: "Enter" },
    displayKeys: (ctx) => [ctx.shiftKey, ctx.enterKey],
  },
  "recall-previous-prompt": {
    id: "recall-previous-prompt",
    label: "Recall previous prompt",
    group: "in-chats",
    scope: "composer",
    defaultBinding: { mod: "forbidden", alt: "forbidden", key: "ArrowUp" },
    displayKeys: (ctx) => [ctx.upKey],
  },
  "recall-next-prompt": {
    id: "recall-next-prompt",
    label: "Recall next prompt",
    group: "in-chats",
    scope: "composer",
    defaultBinding: { mod: "forbidden", alt: "forbidden", key: "ArrowDown" },
    displayKeys: (ctx) => [ctx.downKey],
  },
  "accept-approval": {
    id: "accept-approval",
    label: "Accept approval prompt",
    group: "in-chats",
    scope: "global",
    defaultBinding: {
      mod: "required",
      alt: "forbidden",
      shift: "forbidden",
      key: "Enter",
    },
    displayKeys: (ctx) => [ctx.modKey, ctx.enterKey],
  },
  "stop-response": {
    id: "stop-response",
    label: "Stop response",
    group: "in-chats",
    scope: "composer",
    defaultBinding: { mod: "forbidden", alt: "forbidden", key: "Escape" },
    displayKeys: () => ["Esc"],
  },
  "previous-session": {
    id: "previous-session",
    label: "Previous session",
    group: "navigation",
    scope: "global",
    defaultBinding: {
      mod: "required",
      alt: "forbidden",
      shift: "forbidden",
      key: "ArrowUp",
    },
    displayKeys: (ctx) => [ctx.modKey, ctx.upKey],
  },
  "next-session": {
    id: "next-session",
    label: "Next session",
    group: "navigation",
    scope: "global",
    defaultBinding: {
      mod: "required",
      alt: "forbidden",
      shift: "forbidden",
      key: "ArrowDown",
    },
    displayKeys: (ctx) => [ctx.modKey, ctx.downKey],
  },
  "jump-pinned-session": {
    id: "jump-pinned-session",
    label: "Jump to pinned session (1–10)",
    group: "navigation",
    scope: "global",
    defaultBinding: {
      native: {
        mod: "required",
        alt: "forbidden",
        shift: "forbidden",
        keys: PINNED_HOTKEY_DIGITS,
      },
      browser: {
        mod: "required",
        alt: "required",
        shift: "forbidden",
        codes: PINNED_HOTKEY_CODES,
        rejectAltGraph: true,
      },
    },
    displayKeys: (ctx) =>
      ctx.isNativeShell ? [ctx.modKey, "1…0"] : [ctx.modKey, ctx.altKey, "1…0"],
  },
  "toggle-conversations-sidebar": {
    id: "toggle-conversations-sidebar",
    label: "Toggle conversations sidebar",
    group: "view",
    scope: "global",
    defaultBinding: {
      mod: "required",
      alt: "required",
      shift: "forbidden",
      code: "BracketLeft",
      rejectAltGraph: true,
    },
    displayKeys: (ctx) => [ctx.modKey, ctx.altKey, "["],
  },
  "toggle-workspace-sidebar": {
    id: "toggle-workspace-sidebar",
    label: "Toggle workspace sidebar",
    group: "view",
    scope: "global",
    defaultBinding: {
      mod: "required",
      alt: "required",
      shift: "forbidden",
      code: "BracketRight",
      rejectAltGraph: true,
    },
    displayKeys: (ctx) => [ctx.modKey, ctx.altKey, "]"],
  },
  "slash-navigate-up": {
    id: "slash-navigate-up",
    label: "Navigate suggestions",
    group: "slash-commands",
    scope: "slash-menu",
    defaultBinding: SLASH_NAV_UP,
    displayKeys: (ctx) => [ctx.upKey, ctx.downKey],
  },
  "slash-navigate-down": {
    id: "slash-navigate-down",
    label: "Navigate suggestions",
    group: "slash-commands",
    scope: "slash-menu",
    defaultBinding: SLASH_NAV_DOWN,
    displayKeys: () => [],
  },
  "slash-apply-command": {
    id: "slash-apply-command",
    label: "Apply highlighted command",
    group: "slash-commands",
    scope: "slash-menu",
    defaultBinding: SLASH_APPLY,
    displayKeys: () => ["Tab"],
  },
  "slash-dismiss-menu": {
    id: "slash-dismiss-menu",
    label: "Dismiss menu",
    group: "slash-commands",
    scope: "slash-menu",
    defaultBinding: SLASH_DISMISS,
    displayKeys: () => ["Esc"],
  },
  "mention-navigate-up": {
    id: "mention-navigate-up",
    label: "Navigate suggestions",
    group: "slash-commands",
    scope: "mention-menu",
    defaultBinding: MENTION_NAV_UP,
    displayKeys: () => [],
  },
  "mention-navigate-down": {
    id: "mention-navigate-down",
    label: "Navigate suggestions",
    group: "slash-commands",
    scope: "mention-menu",
    defaultBinding: MENTION_NAV_DOWN,
    displayKeys: () => [],
  },
  "mention-apply": {
    id: "mention-apply",
    label: "Apply highlighted command",
    group: "slash-commands",
    scope: "mention-menu",
    defaultBinding: MENTION_APPLY,
    displayKeys: () => [],
  },
  "mention-dismiss": {
    id: "mention-dismiss",
    label: "Dismiss menu",
    group: "slash-commands",
    scope: "mention-menu",
    defaultBinding: MENTION_DISMISS,
    displayKeys: () => [],
  },
};

const GROUP_ORDER: KeymapGroupId[] = [
  "general",
  "in-chats",
  "navigation",
  "view",
  "slash-commands",
];

/** Commands shown in the shortcuts list, in group order (one row per label). */
const DISPLAY_COMMAND_IDS: KeymapCommandId[] = [
  "command-palette",
  "show-keyboard-shortcuts",
  "send-message",
  "new-line-in-message",
  "recall-previous-prompt",
  "recall-next-prompt",
  "accept-approval",
  "stop-response",
  "previous-session",
  "next-session",
  "jump-pinned-session",
  "toggle-conversations-sidebar",
  "toggle-workspace-sidebar",
  "slash-navigate-up",
  "slash-apply-command",
  "slash-dismiss-menu",
];

function resolveDisplayKeys(command: KeymapCommand, ctx: KeymapDisplayContext): readonly string[] {
  const keys =
    typeof command.displayKeys === "function" ? command.displayKeys(ctx) : command.displayKeys;
  return keys.length > 0 ? keys : [];
}

export function resolveCommandDefaultBinding(
  binding: KeyBinding | PlatformKeyBinding,
  native?: boolean,
): KeyBinding {
  if ("native" in binding) {
    const isNative = native ?? false;
    return isNative ? binding.native : binding.browser;
  }
  return binding;
}

/** Shortcut groups for the reference list / settings panel. */
export function getShortcutGroups(isNative: boolean): KeymapShortcutGroup[] {
  const ctx = defaultDisplayContext(isNative);
  const byGroup = new Map<KeymapGroupId, KeymapShortcutGroup>();

  for (const groupId of GROUP_ORDER) {
    byGroup.set(groupId, {
      title: GROUP_TITLES[groupId],
      note: GROUP_NOTES[groupId],
      items: [],
    });
  }

  for (const id of DISPLAY_COMMAND_IDS) {
    const command = KEYMAP_COMMANDS[id];
    const keys = resolveDisplayKeys(command, ctx);
    if (keys.length === 0) continue;
    const group = byGroup.get(command.group)!;
    group.items.push({ label: command.label, keys });
  }

  return GROUP_ORDER.map((id) => byGroup.get(id)!);
}

export function getKeymapCommand(id: KeymapCommandId): KeymapCommand {
  return KEYMAP_COMMANDS[id];
}

export const KEYMAP_COMMAND_IDS = Object.keys(KEYMAP_COMMANDS) as KeymapCommandId[];
