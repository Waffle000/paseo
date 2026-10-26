import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
const desktop = vi.hoisted(() => ({
  root: "",
  handlers: new Map<string, () => Promise<string>>(),
  appEvents: new Map<string, (event: unknown, contents: EventEmitter) => void>(),
}));
vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => path.join(desktop.root, "desktop"),
    on: (name: string, handler: (event: unknown, contents: EventEmitter) => void) =>
      desktop.appEvents.set(name, handler),
  },
  ipcMain: {
    handle: (name: string, handler: () => Promise<string>) => desktop.handlers.set(name, handler),
  },
}));
import { closeDiagramEditor, registerDiagramEditor } from "./diagram-editor";

it("rejects foreign origins, missing capabilities, traversal and write requests", async () => {
  desktop.root = await mkdtemp(path.join(tmpdir(), "paseo-diagram-origin-"));
  const assets = path.join(desktop.root, "app/public/drawio");
  await mkdir(assets, { recursive: true });
  await writeFile(path.join(assets, "index.html"), "<!doctype html><title>Local editor</title>");
  await writeFile(path.join(desktop.root, "private.txt"), "private-content-sentinel");
  registerDiagramEditor();
  try {
    const url = await desktop.handlers.get("paseo:diagram:open")!();
    expect((await fetch(url, { headers: { Origin: "null" } })).status).toBe(200);
    expect((await fetch(url, { headers: { Origin: "https://foreign.example" } })).status).toBe(403);
    expect((await fetch(new URL("/index.html", url))).status).toBe(403);
    const outside = await fetch(new URL("%2e%2e%2f%2e%2e%2fprivate.txt", url));
    expect(outside.status).toBe(403);
    expect(await outside.text()).not.toContain("private-content-sentinel");
    expect((await fetch(url, { method: "POST", body: "replace editor" })).status).toBe(405);
    const contents = new EventEmitter();
    desktop.appEvents.get("web-contents-created")!(undefined, contents);
    const blocked = vi.fn();
    contents.emit("will-frame-navigate", {
      frame: { url },
      url: "https://foreign.example/",
      preventDefault: blocked,
    });
    expect(blocked).toHaveBeenCalledOnce();
    const allowed = vi.fn();
    contents.emit("will-frame-navigate", {
      frame: { url },
      url: new URL("js/main.js", url).toString(),
      preventDefault: allowed,
    });
    expect(allowed).not.toHaveBeenCalled();
  } finally {
    closeDiagramEditor();
    desktop.handlers.clear();
    desktop.appEvents.clear();
    await rm(desktop.root, { recursive: true, force: true });
  }
});
