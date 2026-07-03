import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bubble } from "@/lib/renderItems";
import { FileViewerContext } from "@/shell/FileViewerContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useChatStore } from "@/store/chatStore";
import { BubbleView, QueuedMessages } from "./ChatPage";

// The steer/delete buttons use the app's Tooltip, which needs a
// TooltipProvider ancestor (the app root supplies one globally). Mirror
// that here so bare QueuedMessages renders don't throw.
function renderQueue() {
  return render(
    <TooltipProvider>
      <QueuedMessages />
    </TooltipProvider>,
  );
}

// UserBubble renders its text through the same markdown renderer as the
// assistant bubble (FilePathAwareMessageResponse → Streamdown). These tests
// pin that wiring: if the text path reverts to a raw `{text}` string, the
// markdown syntax would render literally and these assertions would fail.

afterEach(cleanup);

const FILE_VIEWER_NOOP = {
  openFile: () => {},
  isChangedPath: () => false,
  conversationId: undefined,
  workspaceRoot: null,
  workspaceHome: null,
};

function userBubble(text: string, overrides: Partial<Extract<Bubble, { kind: "user" }>> = {}) {
  return {
    kind: "user" as const,
    itemId: "u1",
    content: [{ type: "input_text" as const, text }],
    ...overrides,
  };
}

function assistantBubble(
  lifecycle: Extract<Bubble, { kind: "assistant" }>["lifecycle"],
  text = "partial answer",
): Extract<Bubble, { kind: "assistant" }> {
  return {
    kind: "assistant",
    responseId: "codex_turn_123",
    stableId: "msg_1",
    lifecycle,
    error: null,
    items: [{ kind: "text", itemId: "msg_1", text, final: true }],
  };
}

function renderBubble(bubble: Bubble) {
  return render(
    <FileViewerContext.Provider value={FILE_VIEWER_NOOP}>
      <BubbleView bubble={bubble} />
    </FileViewerContext.Provider>,
  );
}

describe("UserBubble markdown rendering", () => {
  it("renders **bold** markdown as a strong node, not literal asterisks", () => {
    renderBubble(userBubble("hello **world**"));
    // Streamdown emits bold as an element tagged data-streamdown="strong"
    // (a <span class="font-semibold">, not a literal <strong>). Finding it
    // proves the inline markdown parser ran; a raw-text path would have no
    // such node.
    const bolded = screen.getByText("world");
    expect(bolded.getAttribute("data-streamdown")).toBe("strong");
    // The literal markdown source must NOT survive as text.
    expect(screen.queryByText(/\*\*world\*\*/)).toBeNull();
  });

  it("renders a markdown list as <li> items", async () => {
    renderBubble(userBubble("- first\n- second"));
    // Two list items prove the markdown block parser ran. A raw-text path
    // would render the source as a single line with literal hyphens.
    const first = await screen.findByText("first", { selector: "li, li *" });
    const second = await screen.findByText("second", { selector: "li, li *" });
    expect(first.closest("li")).not.toBeNull();
    expect(second.closest("li")).not.toBeNull();
  });

  it("renders fenced code blocks inside a <pre> wrapper", async () => {
    renderBubble(userBubble("```python\ndef foo():\n    return 1\n```\n"));
    // Mirrors the assistant-side guarantee: fenced code keeps its <pre>
    // wrapper rather than collapsing to inline text.
    const pre = await screen.findByText(/def foo/, { selector: "pre, pre *" });
    expect(pre.closest("pre")).not.toBeNull();
  });

  it("keeps single newlines as <br> line breaks (remark-breaks)", () => {
    const { container } = renderBubble(userBubble("line one\nline two"));
    // The `breaks` prop appends remark-breaks, so a single newline becomes a
    // hard <br>. Without it, CommonMark would collapse the newline to a space
    // and this query would find no <br>. Both lines live in one paragraph.
    expect(container.querySelectorAll("br").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/line one/)).toBeDefined();
    expect(screen.getByText(/line two/)).toBeDefined();
  });

  it("still renders GFM tables — remark-breaks extends, not replaces, the defaults", async () => {
    renderBubble(userBubble("| a | b |\n| - | - |\n| 1 | 2 |"));
    // The regression guard for the extend-not-replace decision: if we had
    // passed [remarkBreaks] alone, Streamdown would drop remark-gfm and this
    // table would render as literal pipe text with no <table>/<td>.
    const cell = await screen.findByText("1", { selector: "td, td *" });
    expect(cell.closest("table")).not.toBeNull();
  });
});

function heldMsg(tempId: string, text: string) {
  return {
    tempId,
    content: [{ type: "input_text" as const, text }],
    text,
    files: [] as File[],
    agentId: "agent_x",
  };
}

describe("QueuedMessages docked list (held-only)", () => {
  afterEach(() => {
    useChatStore.setState({ heldMessages: [], pendingUserMessages: [] });
  });

  it("renders a held row with Steer and Delete actions", () => {
    useChatStore.setState({
      heldMessages: [heldMsg("h1", "queued follow-up")],
      pendingUserMessages: [],
    });
    renderQueue();
    const row = screen.getByTestId("queued-message");
    expect(row).toHaveAttribute("data-queued-state", "held");
    expect(row).toHaveTextContent("queued follow-up");
    // Every strip row is a held message — always actionable: send-now + remove.
    expect(screen.getByTestId("queued-steer")).toBeInTheDocument();
    expect(screen.getByTestId("queued-delete")).toBeInTheDocument();
  });

  it("stacks multiple held rows in FIFO order", () => {
    useChatStore.setState({
      heldMessages: [heldMsg("h1", "first"), heldMsg("h2", "second")],
      pendingUserMessages: [],
    });
    renderQueue();
    const rows = screen.getAllByTestId("queued-message");
    expect(rows[0]).toHaveTextContent("first");
    expect(rows[1]).toHaveTextContent("second");
  });

  it("Delete drops the held row with no server round trip", () => {
    useChatStore.setState({
      heldMessages: [heldMsg("h1", "cancel me"), heldMsg("h2", "keep me")],
      pendingUserMessages: [],
    });
    renderQueue();
    // Delete the first row.
    fireEvent.click(screen.getAllByTestId("queued-delete")[0]!);
    expect(useChatStore.getState().heldMessages.map((h) => h.text)).toEqual(["keep me"]);
    expect(screen.getByTestId("queued-message")).toHaveTextContent("keep me");
  });

  it("Steer hands the held message to steerHeldMessage", () => {
    const realSteer = useChatStore.getState().steerHeldMessage;
    const steerSpy = vi.fn();
    useChatStore.setState({
      steerHeldMessage: steerSpy,
      heldMessages: [heldMsg("h1", "send now")],
      pendingUserMessages: [],
    });
    renderQueue();
    fireEvent.click(screen.getByTestId("queued-steer"));
    expect(steerSpy).toHaveBeenCalledWith("h1");
    // Restore so the spy can't leak into a later test.
    useChatStore.setState({ steerHeldMessage: realSteer });
  });

  it("keeps steered (queued) sends OUT of the strip — they render inline instead", () => {
    // A steered send is a queued pending entry; it moves into the transcript
    // (see UserBubble), so the docked strip (held-only) must ignore it.
    useChatStore.setState({
      heldMessages: [],
      pendingUserMessages: [
        { tempId: "p1", content: [{ type: "input_text", text: "on its way" }], queued: true },
      ],
    });
    const { container } = renderQueue();
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("queued-messages")).toBeNull();
  });
});

describe("UserBubble steered (queued) treatment", () => {
  it("renders a steered bubble at full opacity with a status caption underneath", () => {
    renderBubble(userBubble("on its way", { queued: true }));
    const bubble = screen.getByTestId("message-bubble");
    expect(bubble).toHaveAttribute("data-queued", "true");
    // No fade: a washed-out bubble reads as "failed to send" and dims the
    // user's own text. The caption alone carries the pending state.
    expect(bubble.className).not.toContain("opacity-70");
    const caption = screen.getByTestId("queued-bubble-indicator");
    expect(caption).toHaveTextContent("Queued — waiting to be picked up");
  });

  it("renders a normal (committed) bubble with no caption", () => {
    // Drop-on-pickup: a committed bubble carries no `queued`, so the
    // caption lifts on its own once the message is promoted.
    renderBubble(userBubble("delivered"));
    const bubble = screen.getByTestId("message-bubble");
    expect(bubble).not.toHaveAttribute("data-queued");
    expect(screen.queryByTestId("queued-bubble-indicator")).toBeNull();
  });

  it("never applies the queued treatment to a [System: ...] notification", () => {
    // System markers render via SystemMessageView before any bubble chrome.
    renderBubble(userBubble("[System: task done]", { queued: true }));
    expect(screen.queryByTestId("message-bubble")).toBeNull();
    expect(screen.queryByTestId("queued-bubble-indicator")).toBeNull();
  });
});

describe("AssistantBubble lifecycle rendering", () => {
  it("shows an interrupted indicator for cancelled assistant bubbles", () => {
    renderBubble(assistantBubble("cancelled"));

    expect(screen.getByTestId("assistant-interrupted-indicator")).toHaveTextContent("Interrupted");
  });

  it("does not show an interrupted indicator for completed assistant bubbles", () => {
    renderBubble(assistantBubble("completed"));

    expect(screen.queryByTestId("assistant-interrupted-indicator")).toBeNull();
  });
});
