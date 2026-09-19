import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../src/storage/fileStore.js";
import { rememberObject, findObject } from "../src/domain/objectMemory.js";

let store: ReturnType<typeof createFileStore>;
beforeEach(() => {
  store = createFileStore(mkdtempSync(join(tmpdir(), "wf-")));
});

describe("object memory", () => {
  it("remembers and finds an object, case-insensitively", async () => {
    await rememberObject(store, { name: "Keys", locationNote: "entry table", imageRef: "img1" });
    const found = await findObject(store, "keys");
    expect(found?.locationNote).toBe("entry table");
  });

  it("returns null when not found", async () => {
    expect(await findObject(store, "passport")).toBeNull();
  });
});
