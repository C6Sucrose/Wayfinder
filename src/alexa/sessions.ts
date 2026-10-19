import type { HistoryEntry } from "../agent/types.js";

export const MAX_TURNS = 10;
export const TTL_MS = 300_000;
export const MAX_SESSIONS = 1000;

interface Session {
  entries: HistoryEntry[];
  touchedAt: number;
}

export interface SessionStore {
  history(sessionId: string): HistoryEntry[];
  append(sessionId: string, entries: HistoryEntry[]): void;
  size(): number;
  clear(): void;
}

export function createSessionStore(options: { now?: () => number } = {}): SessionStore {
  const now = options.now ?? (() => Date.now());
  const sessions = new Map<string, Session>();

  const prune = (at: number): void => {
    for (const [id, session] of sessions) {
      if (at - session.touchedAt > TTL_MS) sessions.delete(id);
    }
    while (sessions.size > MAX_SESSIONS) {
      const oldest = sessions.keys().next();
      if (oldest.done) break;
      sessions.delete(oldest.value);
    }
  };

  return {
    history(sessionId) {
      if (!sessionId) return [];
      const session = sessions.get(sessionId);
      if (!session) return [];
      if (now() - session.touchedAt > TTL_MS) {
        sessions.delete(sessionId);
        return [];
      }
      return session.entries.slice(-MAX_TURNS);
    },
    append(sessionId, entries) {
      if (!sessionId) return;
      const at = now();
      prune(at);
      const session = sessions.get(sessionId) ?? { entries: [], touchedAt: at };
      session.entries = [...session.entries, ...entries].slice(-MAX_TURNS);
      session.touchedAt = at;
      sessions.delete(sessionId);
      sessions.set(sessionId, session);
      prune(at);
    },
    size() {
      prune(now());
      return sessions.size;
    },
    clear() {
      sessions.clear();
    }
  };
}
