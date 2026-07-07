import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MentionState } from "@/lib/composerMentions";
import type { WorkspaceFile } from "@/hooks/useWorkspaceChangedFiles";
import { useMentionBrowser } from "./useMentionBrowser";

function makeKeyEvent(
  key: string,
  mods: Partial<{
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  }> = {},
): React.KeyboardEvent<HTMLTextAreaElement> {
  const preventDefault = vi.fn();
  return {
    key,
    code: key.startsWith("Arrow") ? key : "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
    preventDefault,
  } as unknown as React.KeyboardEvent<HTMLTextAreaElement>;
}

function setup(entries: WorkspaceFile[]) {
  const mention: MentionState = { query: "src", start: 0, end: 4 };
  const setMention = vi.fn();
  const setText = vi.fn();
  const textareaRef = { current: document.createElement("textarea") };

  const { result, rerender } = renderHook(
    (props: { entries: WorkspaceFile[] }) =>
      useMentionBrowser({
        mention,
        setMention,
        mentionEntries: props.entries,
        text: "@src",
        setText,
        textareaRef,
      }),
    { initialProps: { entries } },
  );

  return { result, rerender, setMention };
}

describe("useMentionBrowser handleKeyDown", () => {
  const entries: WorkspaceFile[] = [
    { type: "file", path: "a.ts", name: "a.ts", bytes: 1, modified_at: 0 },
    { type: "file", path: "b.ts", name: "b.ts", bytes: 1, modified_at: 0 },
  ];

  it("Cmd+ArrowDown navigates the menu and consumes the event", () => {
    const { result } = setup(entries);
    const e = makeKeyEvent("ArrowDown", { metaKey: true });

    let consumed = false;
    act(() => {
      consumed = result.current.handleKeyDown(e);
    });

    expect(consumed).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(result.current.mentionIndex).toBe(1);
  });

  it("Ctrl+ArrowUp wraps to the last row with modifiers held", () => {
    const { result } = setup(entries);
    const e = makeKeyEvent("ArrowUp", { ctrlKey: true });

    let consumed = false;
    act(() => {
      consumed = result.current.handleKeyDown(e);
    });

    expect(consumed).toBe(true);
    expect(result.current.mentionIndex).toBe(1);
  });

  it("Ctrl+Tab applies the highlighted row", () => {
    const { result } = setup(entries);
    const e = makeKeyEvent("Tab", { ctrlKey: true });

    let consumed = false;
    act(() => {
      consumed = result.current.handleKeyDown(e);
    });

    expect(consumed).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("does nothing when the menu is closed", () => {
    const { result, rerender } = setup(entries);
    rerender({ entries: [] });

    const e = makeKeyEvent("ArrowDown", { metaKey: true });
    expect(result.current.handleKeyDown(e)).toBe(false);
  });
});
