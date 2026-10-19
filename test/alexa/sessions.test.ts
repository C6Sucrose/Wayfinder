import { describe, it, expect } from "vitest";
import { createSessionStore, MAX_TURNS, MAX_SESSIONS } from "../../src/alexa/sessions.js";

describe("session store", () => {
  it("returns an empty history for an unknown session", () => {
    expect(createSessionStore().history("s1")).toEqual([]);
  });

  it("appends and reads turns", () => {
    const store = createSessionStore();
    store.append("s1", [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }]);
    expect(store.history("s1")).toEqual([{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }]);
  });

  it("keeps only the last MAX_TURNS turns", () => {
    const store = createSessionStore();
    for (let i = 0; i < MAX_TURNS + 5; i += 1) {
      store.append("s1", [{ role: "user", text: `t${i}` }]);
    }
    const history = store.history("s1");
    expect(history).toHaveLength(MAX_TURNS);
    expect(history.at(-1)?.text).toBe(`t${MAX_TURNS + 4}`);
  });

  it("isolates sessions", () => {
    const store = createSessionStore();
    store.append("a", [{ role: "user", text: "a" }]);
    store.append("b", [{ role: "user", text: "b" }]);
    expect(store.history("a")[0]?.text).toBe("a");
    expect(store.history("b")[0]?.text).toBe("b");
  });

  it("expires sessions after the TTL", () => {
    let clock = 1_000_000;
    const store = createSessionStore({ now: () => clock });
    store.append("s1", [{ role: "user", text: "hi" }]);
    clock += 300_001;
    expect(store.history("s1")).toEqual([]);
  });

  it("evicts the oldest session beyond MAX_SESSIONS", () => {
    const store = createSessionStore();
    for (let i = 0; i < MAX_SESSIONS + 2; i += 1) {
      store.append(`s${i}`, [{ role: "user", text: "x" }]);
    }
    expect(store.size()).toBe(MAX_SESSIONS);
    expect(store.history("s0")).toEqual([]);
    expect(store.history(`s${MAX_SESSIONS + 1}`)).toHaveLength(1);
  });

  it("treats an empty session id as stateless", () => {
    const store = createSessionStore();
    store.append("", [{ role: "user", text: "x" }]);
    expect(store.history("")).toEqual([]);
  });
});
