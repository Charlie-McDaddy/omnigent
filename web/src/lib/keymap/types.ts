// Typed keymap model: named commands, physical bindings, and UI scopes.

/** Where a command is meant to fire — used for grouping and future conflict rules. */
export type KeymapScope = "global" | "composer" | "slash-menu" | "mention-menu" | "code-viewer";

export type KeymapGroupId = "general" | "in-chats" | "navigation" | "view" | "slash-commands";

/** Whether a modifier must be held, must not be held, or is unconstrained. */
export type ModifierRequirement = "required" | "forbidden" | "any";

/**
 * A single chord or key press. Match `key` against `e.key` and `code` against
 * `e.code`; `keys` / `codes` match any listed value. The primary platform
 * modifier (⌘ on macOS, Ctrl elsewhere) is `mod` and matches `metaKey || ctrlKey`.
 */
export interface KeyBinding {
  mod?: ModifierRequirement;
  alt?: ModifierRequirement;
  shift?: ModifierRequirement;
  key?: string;
  code?: string;
  keys?: readonly string[];
  codes?: readonly string[];
  /** When set, reject AltGr even if alt is not required (intl layout guard). */
  rejectAltGraph?: boolean;
}

/** Platform-specific default for commands whose chord differs by shell. */
export interface PlatformKeyBinding {
  native: KeyBinding;
  browser: KeyBinding;
}

/** Minimal key-event shape for matching (DOM or React synthetic events). */
export interface KeymapKeyEvent {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  getModifierState?(key: string): boolean;
}

export type KeymapCommandId =
  | "command-palette"
  | "show-keyboard-shortcuts"
  | "send-message"
  | "new-line-in-message"
  | "recall-previous-prompt"
  | "recall-next-prompt"
  | "accept-approval"
  | "stop-response"
  | "previous-session"
  | "next-session"
  | "jump-pinned-session"
  | "toggle-conversations-sidebar"
  | "toggle-workspace-sidebar"
  | "slash-navigate-up"
  | "slash-navigate-down"
  | "slash-apply-command"
  | "slash-dismiss-menu"
  | "mention-navigate-up"
  | "mention-navigate-down"
  | "mention-apply"
  | "mention-dismiss";

export interface KeymapCommand {
  id: KeymapCommandId;
  label: string;
  group: KeymapGroupId;
  scope: KeymapScope;
  /** Default chord(s). Platform pair when the shell changes the binding. */
  defaultBinding: KeyBinding | PlatformKeyBinding;
  /**
   * Keys rendered left→right in shortcut lists. A function receives display
   * context (platform shell, modifier glyphs).
   */
  displayKeys: readonly string[] | ((ctx: KeymapDisplayContext) => readonly string[]);
}

export interface KeymapDisplayContext {
  modKey: string;
  altKey: string;
  shiftKey: string;
  enterKey: string;
  upKey: string;
  downKey: string;
  isNativeShell: boolean;
}

export interface KeymapShortcutGroup {
  title: string;
  note?: string;
  items: Array<{ label: string; keys: readonly string[] }>;
}
