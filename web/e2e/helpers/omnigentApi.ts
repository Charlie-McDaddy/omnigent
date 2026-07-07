import { requireEnv } from "./loadEnv";

export interface RemoteSession {
  id: string;
  title: string | null;
}

export interface SwitchPairProbe {
  fromId: string;
  toId: string;
  fromHistoryMs: number;
  fromSnapshotMs: number;
  toHistoryMs: number;
  toSnapshotMs: number;
  /** Positive when snapshot finishes after history on the target session. */
  snapshotLeadMs: number;
}

function omnigentApiUrl(apiPath: string): string {
  const base = new URL(requireEnv("OMNIGENT_URL"));
  const prefix = base.pathname.replace(/\/$/, "");
  const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  return `${base.origin}${prefix}${path}`;
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${requireEnv("OMNIGENT_AUTH_TOKEN")}` };
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
}

/** List recent top-level sessions from the remote Omnigent deployment. */
export async function listRecentSessions(limit = 30): Promise<RemoteSession[]> {
  const url = omnigentApiUrl(`/v1/sessions?limit=${limit}`);
  const page = await readJson<{
    data: Array<{ id: string; title: string | null; parent_session_id?: string | null }>;
  }>(await fetch(url, { headers: authHeaders() }));
  return page.data
    .filter((s) => s.parent_session_id == null)
    .map((s) => ({ id: s.id, title: s.title ?? null }));
}

/** True when the session has at least one committed item. */
export async function sessionHasItems(sessionId: string): Promise<boolean> {
  const url = omnigentApiUrl(
    `/v1/sessions/${encodeURIComponent(sessionId)}/items?limit=1&order=desc`,
  );
  const page = await readJson<{ data: unknown[] }>(await fetch(url, { headers: authHeaders() }));
  return page.data.length > 0;
}

async function timedFetch(url: string): Promise<number> {
  const t0 = performance.now();
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text.slice(0, 120)}`);
  }
  await res.arrayBuffer();
  return performance.now() - t0;
}

async function probeSession(sessionId: string): Promise<{ historyMs: number; snapshotMs: number }> {
  const historyUrl = omnigentApiUrl(
    `/v1/sessions/${encodeURIComponent(sessionId)}/items?limit=50&order=desc`,
  );
  const snapshotUrl = omnigentApiUrl(`/v1/sessions/${encodeURIComponent(sessionId)}?refresh_state=true`);
  const [historyMs, snapshotMs] = await Promise.all([
    timedFetch(historyUrl),
    timedFetch(snapshotUrl),
  ]);
  return { historyMs, snapshotMs };
}

export interface PickSwitchPairOptions {
  minSnapshotLeadMs?: number;
  minTurns?: number;
}

/**
 * Pick two distinct sessions with transcript history. When possible, prefer a
 * pair whose target session has snapshot slower than history (the scenario the
 * hydration split optimizes).
 */
export async function pickSwitchPair(
  opts: PickSwitchPairOptions = {},
): Promise<SwitchPairProbe> {
  const minSnapshotLead = Number(
    process.env.SESSION_SWITCH_MIN_SNAPSHOT_LEAD_MS ?? opts.minSnapshotLeadMs ?? 100,
  );
  const fromOverride = process.env.SESSION_SWITCH_FROM;
  const toOverride = process.env.SESSION_SWITCH_TO;
  if (fromOverride && toOverride && fromOverride !== toOverride) {
    const [fromProbe, toProbe] = await Promise.all([
      probeSession(fromOverride),
      probeSession(toOverride),
    ]);
    return {
      fromId: fromOverride,
      toId: toOverride,
      fromHistoryMs: fromProbe.historyMs,
      fromSnapshotMs: fromProbe.snapshotMs,
      toHistoryMs: toProbe.historyMs,
      toSnapshotMs: toProbe.snapshotMs,
      snapshotLeadMs: toProbe.snapshotMs - toProbe.historyMs,
    };
  }

  const candidates: string[] = [];
  for (const session of await listRecentSessions(40)) {
    if (await sessionHasItems(session.id)) candidates.push(session.id);
    if (candidates.length >= 8) break;
  }
  if (candidates.length < 2) {
    throw new Error(
      "Need at least two sessions with items on the remote host. " +
        "Create chats or set SESSION_SWITCH_FROM / SESSION_SWITCH_TO.",
    );
  }

  let best: SwitchPairProbe | null = null;
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = 0; j < candidates.length; j += 1) {
      if (i === j) continue;
      const fromId = candidates[i]!;
      const toId = candidates[j]!;
      const [fromProbe, toProbe] = await Promise.all([probeSession(fromId), probeSession(toId)]);
      const snapshotLeadMs = toProbe.snapshotMs - toProbe.historyMs;
      const row: SwitchPairProbe = {
        fromId,
        toId,
        fromHistoryMs: fromProbe.historyMs,
        fromSnapshotMs: fromProbe.snapshotMs,
        toHistoryMs: toProbe.historyMs,
        toSnapshotMs: toProbe.snapshotMs,
        snapshotLeadMs,
      };
      if (snapshotLeadMs >= minSnapshotLead) return row;
      if (best === null || snapshotLeadMs > best.snapshotLeadMs) best = row;
    }
  }
  return best!;
}
