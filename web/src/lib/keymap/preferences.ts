// Persisted user overrides for keyboard shortcuts (`omnigent:keymap`).
//
// Overrides are a partial map of command id → binding. At read time each
// stored binding fully *replaces* the registry default (no field-level merge).
// Platform-paired defaults (e.g. jump-pinned-session) collapse to a single
// override binding — the PR 2 editor must account for that when remapping.

import type { KeyBinding, KeymapCommandId, PlatformKeyBinding } from "./types";
import { KEYMAP_COMMANDS, resolveCommandDefaultBinding } from "./registry";

const STORAGE_KEY = "omnigent:keymap";

export type KeymapOverrides = Partial<Record<KeymapCommandId, KeyBinding>>;

let cachedOverrides: KeymapOverrides | null = null;
let cachedRaw: string | null | undefined;

function invalidateOverrideCache(): void {
  cachedOverrides = null;
  cachedRaw = undefined;
}

function isModifierRequirement(value: unknown): value is KeyBinding["mod"] {
  return value === "required" || value === "forbidden" || value === "any";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Coerce one stored binding; returns null when the shape can't be salvaged. */
function coerceBinding(value: unknown): KeyBinding | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const binding: KeyBinding = {};

  if (raw.mod !== undefined) {
    if (!isModifierRequirement(raw.mod)) return null;
    binding.mod = raw.mod;
  }
  if (raw.alt !== undefined) {
    if (!isModifierRequirement(raw.alt)) return null;
    binding.alt = raw.alt;
  }
  if (raw.shift !== undefined) {
    if (!isModifierRequirement(raw.shift)) return null;
    binding.shift = raw.shift;
  }
  if (raw.key !== undefined) {
    if (typeof raw.key !== "string" || !raw.key) return null;
    binding.key = raw.key;
  }
  if (raw.code !== undefined) {
    if (typeof raw.code !== "string" || !raw.code) return null;
    binding.code = raw.code;
  }
  if (raw.keys !== undefined) {
    if (!isStringArray(raw.keys) || raw.keys.length === 0) return null;
    binding.keys = raw.keys;
  }
  if (raw.codes !== undefined) {
    if (!isStringArray(raw.codes) || raw.codes.length === 0) return null;
    binding.codes = raw.codes;
  }
  if (raw.rejectAltGraph === true) binding.rejectAltGraph = true;

  const hasKey =
    binding.key !== undefined ||
    binding.code !== undefined ||
    binding.keys !== undefined ||
    binding.codes !== undefined;
  if (!hasKey) return null;

  return binding;
}

function readRawOverrides(): KeymapOverrides {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === cachedRaw && cachedOverrides !== null) {
      return cachedOverrides;
    }
    if (!raw) {
      cachedRaw = raw;
      cachedOverrides = {};
      return cachedOverrides;
    }
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      cachedRaw = raw;
      cachedOverrides = {};
      return cachedOverrides;
    }
    const out: KeymapOverrides = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Object.hasOwn(KEYMAP_COMMANDS, id)) continue;
      const binding = coerceBinding(value);
      if (binding) out[id as KeymapCommandId] = binding;
    }
    cachedRaw = raw;
    cachedOverrides = out;
    return out;
  } catch {
    invalidateOverrideCache();
    return {};
  }
}

/**
 * Read persisted overrides. Never throws — corrupt storage yields an empty map.
 */
export function readKeymapOverrides(): KeymapOverrides {
  return readRawOverrides();
}

/**
 * Persist one override. Pass `null` to clear that command's override.
 */
export function writeKeymapOverride(id: KeymapCommandId, binding: KeyBinding | null): void {
  if (typeof window === "undefined") return;
  try {
    const next = { ...readRawOverrides() };
    if (binding === null) {
      delete next[id];
    } else {
      next[id] = binding;
    }
    if (Object.keys(next).length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
      invalidateOverrideCache();
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    invalidateOverrideCache();
  } catch {
    // Quota / access errors shouldn't break the app.
  }
}

/** Remove every stored override. */
export function clearKeymapOverrides(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    invalidateOverrideCache();
  } catch {
    // ignore
  }
}

/**
 * Default binding for `id`, optionally merged with a user override.
 *
 * @param native When true, pick the native-shell variant for platform-paired
 *   defaults (jump-to-pinned). Defaults to {@link isNativeShell}.
 */
export function getEffectiveBinding(id: KeymapCommandId, native?: boolean): KeyBinding {
  const command = KEYMAP_COMMANDS[id];
  const defaultBinding = resolveCommandDefaultBinding(command.defaultBinding, native);
  const override = readRawOverrides()[id];
  return override ?? defaultBinding;
}

/** True when a user override is stored for the command. */
export function isCommandOverridden(id: KeymapCommandId): boolean {
  return readRawOverrides()[id] !== undefined;
}

/** Export for tests and the future editor. */
export function isPlatformBinding(
  binding: KeyBinding | PlatformKeyBinding,
): binding is PlatformKeyBinding {
  return "native" in binding;
}
