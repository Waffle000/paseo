import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({
  userData: "",
  handlers: new Map<string, () => Promise<string>>(),
}));
vi.mock("electron", () => ({
  app: { getPath: () => desktop.userData },
  ipcMain: {
    handle: (name: string, handler: () => Promise<string>) => desktop.handlers.set(name, handler),
  },
}));

import { closeDevicePreviews, registerDevicePreviewHandlers } from "./server";

beforeEach(async () => {
  desktop.userData = await mkdtemp(path.join(tmpdir(), "paseo-preview-test-"));
});
afterEach(async () => {
  await closeDevicePreviews();
  desktop.handlers.clear();
  await rm(desktop.userData, { recursive: true, force: true });
});

describe("local device preview lifecycle", () => {
  it("serves a saved tab URL after restart without opening a new simulator tab", async () => {
    await registerDevicePreviewHandlers();
    const url = await desktop.handlers.get("paseo:simulator:open")!();
    expect((await fetch(url)).status).toBe(200);
    const file = path.join(desktop.userData, "device-preview-endpoint.json");
    const identity = await readFile(file, "utf8");
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
    await closeDevicePreviews();
    await registerDevicePreviewHandlers();
    expect((await fetch(url)).status).toBe(200);
    expect(await readFile(file, "utf8")).toBe(identity);
  });

  it("rejects missing capabilities and cross-origin input before dispatching to a device", async () => {
    await registerDevicePreviewHandlers();
    const url = await desktop.handlers.get("paseo:simulator:open")!();
    expect((await fetch(new URL("/api/devices", url))).status).toBe(403);
    const denied = await fetch(new URL("api/connect", url), {
      method: "POST",
      headers: { Origin: "https://untrusted.example", "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "ios:forbidden" }),
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "Local preview access denied." });
  });
});
