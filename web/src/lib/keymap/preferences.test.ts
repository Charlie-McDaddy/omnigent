import { afterEach, describe, expect, it } from "vitest";

import { clearKeymapOverrides, readKeymapOverrides, writeKeymapOverride } from "./preferences";

const STORAGE_KEY = "omnigent:keymap";

afterEach(() => {
  clearKeymapOverrides();
  localStorage.clear();
});

describe("keymap preferences", () => {
  it("ignores inherited object keys in stored JSON", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ toString: { key: "x" }, "accept-approval": { key: "Enter" } }),
    );
    const overrides = readKeymapOverrides();
    expect(Object.hasOwn(overrides, "toString")).toBe(false);
    expect(overrides["accept-approval"]?.key).toBe("Enter");
  });

  it("reuses the cached override map across reads until a write", () => {
    writeKeymapOverride("accept-approval", { key: "a", mod: "required" });
    const first = readKeymapOverrides();
    const second = readKeymapOverrides();
    expect(second).toBe(first);
    writeKeymapOverride("accept-approval", null);
    const afterClear = readKeymapOverrides();
    expect(afterClear).not.toBe(first);
  });
});
