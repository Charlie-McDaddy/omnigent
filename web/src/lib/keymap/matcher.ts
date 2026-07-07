// Normalize keyboard events and test them against registry bindings.

import type {
  KeyBinding,
  KeymapCommandId,
  KeymapKeyEvent,
  ModifierRequirement,
  PlatformKeyBinding,
} from "./types";
import { getEffectiveBinding } from "./preferences";
import { isNativeShell } from "@/lib/nativeBridge";

function hasPrimaryMod(e: KeymapKeyEvent): boolean {
  return e.metaKey || e.ctrlKey;
}

function satisfiesModifier(
  requirement: ModifierRequirement | undefined,
  present: boolean,
): boolean {
  if (requirement === undefined || requirement === "any") return true;
  if (requirement === "required") return present;
  return !present;
}

function letterMatches(eventKey: string, bindingKey: string): boolean {
  if (bindingKey.length === 1 && /[a-zA-Z]/.test(bindingKey)) {
    return eventKey.toLowerCase() === bindingKey.toLowerCase();
  }
  return eventKey === bindingKey;
}

function matchesKeyField(e: KeymapKeyEvent, binding: KeyBinding): boolean {
  const hasKeyConstraint =
    binding.key !== undefined ||
    binding.code !== undefined ||
    binding.keys !== undefined ||
    binding.codes !== undefined;
  if (!hasKeyConstraint) return false;

  // OR semantics: any one populated key field may match. No current command
  // combines fields; overrides that do would match more broadly than expected.
  if (binding.key !== undefined && letterMatches(e.key, binding.key)) return true;
  if (binding.code !== undefined && e.code === binding.code) return true;
  if (binding.keys?.some((k) => letterMatches(e.key, k))) return true;
  if (binding.codes?.some((c) => e.code === c)) return true;
  return false;
}

/**
 * Test a keyboard event against a single binding. Does not consult user
 * overrides — pass the effective binding from {@link getEffectiveBinding}.
 */
export function matchesBinding(e: KeymapKeyEvent, binding: KeyBinding): boolean {
  if (!satisfiesModifier(binding.mod, hasPrimaryMod(e))) return false;
  if (!satisfiesModifier(binding.alt, e.altKey)) return false;
  if (!satisfiesModifier(binding.shift, e.shiftKey)) return false;

  if (
    binding.rejectAltGraph &&
    typeof e.getModifierState === "function" &&
    e.getModifierState("AltGraph")
  ) {
    return false;
  }

  return matchesKeyField(e, binding);
}

function resolvePlatformBinding(
  binding: KeyBinding | PlatformKeyBinding,
  native: boolean,
): KeyBinding {
  if ("native" in binding) return native ? binding.native : binding.browser;
  return binding;
}

/**
 * Test whether `e` matches the effective binding for `commandId` (defaults
 * merged with user overrides from localStorage).
 */
export function matchesCommand(commandId: KeymapCommandId, e: KeymapKeyEvent): boolean {
  const binding = getEffectiveBinding(commandId, isNativeShell());
  return matchesBinding(e, binding);
}

/** Resolve the platform-appropriate default before overrides. */
export function resolveDefaultBinding(
  binding: KeyBinding | PlatformKeyBinding,
  native: boolean = isNativeShell(),
): KeyBinding {
  return resolvePlatformBinding(binding, native);
}

/**
 * For pinned-session jump: return the 0-based index when the chord matches,
 * otherwise -1. Digit order is 1–9 then 0 (browser tab style).
 */
export function pinnedSessionIndexFromEvent(e: KeymapKeyEvent): number {
  const binding = getEffectiveBinding("jump-pinned-session", isNativeShell());
  if (!matchesBinding(e, binding)) return -1;

  const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;
  const codes = [
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

  if (binding.keys) {
    return binding.keys.indexOf(e.key as (typeof digits)[number]);
  }
  if (binding.codes) {
    return binding.codes.indexOf(e.code as (typeof codes)[number]);
  }
  return -1;
}
