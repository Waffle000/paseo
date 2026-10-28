import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", () => ({
  app: { getPath: () => desktop.userData },
  ipcMain: { handle: vi.fn() },
}));
import { closeOpenDesign, designHandoff, openDesign } from "./open-design";

beforeEach(async () => {
  desktop.userData = await mkdtemp(path.join(tmpdir(), "meowsh-design-test-"));
  vi.stubEnv("MEOWSH_OPEN_DESIGN_APP", path.join(desktop.userData, "missing.app"));
});
afterEach(async () => {
  closeOpenDesign();
  vi.unstubAllEnvs();
  await rm(desktop.userData, { recursive: true, force: true });
});

describe("Open Design workspace boundary", () => {
  it("rejects relative workspace paths before starting a runtime", async () => {
    await expect(openDesign("../another-project")).rejects.toThrow("absolute local workspace path");
  });
  it("rejects a regular file as a handoff workspace", async () => {
    const file = path.join(desktop.userData, "design.html");
    await writeFile(file, "<h1>Design</h1>");
    await expect(designHandoff(file)).rejects.toThrow("Workspace must be a directory");
  });
  it("reports the installation prerequisite for a valid workspace without a runtime", async () => {
    await expect(openDesign(desktop.userData)).rejects.toThrow(
      "Install the official Open Design macOS app",
    );
  });
});
