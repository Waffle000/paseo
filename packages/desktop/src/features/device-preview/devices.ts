import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
import { androidTools, bootAndroid, captureAndroid, runQueue, runText } from "./commands.js";
import { androidTextCommands, type PreviewAction } from "./input.js";

export interface PreviewDevice {
  id: string;
  name: string;
  platform: "ios" | "android";
}

interface PreviewSession {
  device: PreviewDevice;
  serial: string;
  ticket: string | null;
  width: number;
  height: number;
}

const queueStatus = z.object({
  approved_device: z.object({ udid: z.string(), name: z.string(), os: z.string() }),
  system: z.object({
    blocked: z.boolean(),
    paused: z.boolean(),
    blocked_reason: z.string().nullable(),
  }),
});
const queueTicket = z.object({ ticket_id: z.string() });
const sessions = new Map<string, PreviewSession>();
let iosConnecting = false;

async function androidSerials(): Promise<string[]> {
  const result = await runText(androidTools().adb, ["devices"]);
  return result.split("\n").flatMap((line) => {
    const match = /^(\S+)\s+device(?:\s|$)/.exec(line);
    return match ? [match[1]!] : [];
  });
}

export async function listPreviewDevices(): Promise<{
  devices: PreviewDevice[];
  notices: string[];
}> {
  const devices: PreviewDevice[] = [];
  const notices: string[] = [];
  if (process.platform === "darwin") {
    try {
      const state = queueStatus.parse(await runQueue(["status"]));
      if (!state.system.blocked && !state.system.paused) {
        devices.push({
          id: `ios:${state.approved_device.udid}`,
          name: `${state.approved_device.name} · ${state.approved_device.os} · simq`,
          platform: "ios",
        });
      }
      if (state.system.blocked) notices.push(`iOS queue blocked: ${state.system.blocked_reason}`);
      if (state.system.paused) notices.push("iOS queue is paused.");
      notices.push(
        "iOS requires the approved shared simulator to be booted in Xcode. Access is held through simq until Disconnect.",
      );
    } catch (error) {
      notices.push(error instanceof Error ? error.message : "iOS simulator queue is unavailable.");
    }
  }
  try {
    for (const serial of await androidSerials())
      devices.push({ id: `android:${serial}`, name: serial, platform: "android" });
    const avds = await runText(androidTools().emulator, ["-list-avds"]);
    for (const name of avds
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)) {
      devices.push({ id: `avd:${name}`, name: `${name} · start AVD`, platform: "android" });
    }
  } catch (error) {
    notices.push(error instanceof Error ? error.message : "Android SDK is unavailable.");
  }
  return { devices, notices };
}

async function resolveAndroid(device: PreviewDevice): Promise<string> {
  if (device.id.startsWith("android:")) return device.id.slice(8);
  const name = device.id.slice(4);
  const adb = androidTools().adb;
  async function findAvd(): Promise<string | null> {
    for (const serial of await androidSerials()) {
      if (!serial.startsWith("emulator-")) continue;
      const value = await runText(adb, ["-s", serial, "emu", "avd", "name"]);
      if (value.split("\n")[0]?.trim() === name) return serial;
    }
    return null;
  }
  const running = await findAvd();
  if (running) return running;
  await bootAndroid(name);
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    await delay(1500);
    const serial = await findAvd();
    if (!serial) continue;
    const boot = await runText(adb, ["-s", serial, "shell", "getprop", "sys.boot_completed"]);
    if (boot.trim() === "1") return serial;
  }
  throw new Error("Android emulator did not finish booting within three minutes.");
}

async function acquireIosTicket(): Promise<string> {
  if (iosConnecting) throw new Error("An iOS preview is already waiting for the shared simulator.");
  for (const session of sessions.values()) {
    if (session.ticket)
      throw new Error("Disconnect the existing iOS preview before opening another.");
  }
  iosConnecting = true;
  let ticket: string | null = null;
  try {
    const identity = randomUUID();
    const result = queueTicket.parse(
      await runQueue([
        "enqueue",
        "--project",
        "paseo",
        "--session",
        identity,
        "--label",
        "Interactive simulator tab",
        "--run-key",
        identity,
      ]),
    );
    ticket = result.ticket_id;
    await runQueue(["wait", "--ticket", ticket, "--timeout", "120"], 125000);
    return ticket;
  } catch (error) {
    if (ticket) await runQueue(["cancel", "--ticket", ticket]);
    throw error;
  } finally {
    iosConnecting = false;
  }
}

export async function connectPreview(id: string): Promise<string> {
  const inventory = await listPreviewDevices();
  const device = inventory.devices.find((candidate) => candidate.id === id);
  if (!device) throw new Error("Device is no longer available. Refresh the device list.");
  let ticket: string | null = null;
  let serial = device.id.slice(4);
  if (device.platform === "ios") {
    ticket = await acquireIosTicket();
  } else {
    serial = await resolveAndroid(device);
  }
  const sessionId = randomUUID();
  sessions.set(sessionId, { device, serial, ticket, width: 1, height: 1 });
  return sessionId;
}

function getSession(id: string): PreviewSession {
  const session = sessions.get(id);
  if (!session) throw new Error("Device session is disconnected.");
  return session;
}

export async function previewFrame(id: string): Promise<Buffer> {
  const session = getSession(id);
  let png: Buffer;
  if (session.device.platform === "ios") {
    const directory = await mkdtemp(path.join(tmpdir(), "paseo-simulator-"));
    try {
      const output = path.join(directory, "screen.png");
      await runQueue(["ui", "screenshot", output, "--ticket", session.ticket!]);
      png = await readFile(output);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } else {
    png = await captureAndroid(session.serial);
  }
  if (png.length < 24 || png.toString("hex", 0, 8) !== "89504e470d0a1a0a")
    throw new Error("Device returned an invalid screenshot.");
  session.width = png.readUInt32BE(16);
  session.height = png.readUInt32BE(20);
  return png;
}

export async function controlPreview(id: string, action: PreviewAction): Promise<void> {
  const session = getSession(id);
  if (session.device.platform === "ios") {
    const suffix = ["--ticket", session.ticket!];
    if (action.kind === "tap")
      await runQueue(["ui", "tap", String(action.x), String(action.y), ...suffix]);
    if (action.kind === "text") await runQueue(["ui", "type", action.text, ...suffix]);
    if (action.kind === "home") await runQueue(["ui", "button", "home", ...suffix]);
    if (action.kind === "back")
      throw new Error("iOS has no Back button. Use an on-screen back control or swipe.");
    if (action.kind === "swipe") {
      const steps = [
        { type: "begin", x: action.x, y: action.y },
        { type: "move", x: action.endX, y: action.endY },
        { type: "end", x: action.endX, y: action.endY },
      ];
      await runQueue(["ui", "gesture", JSON.stringify(steps), ...suffix]);
    }
    return;
  }
  const args = ["-s", session.serial, "shell", "input"];
  if (action.kind === "tap")
    args.push(
      "tap",
      String(Math.round(action.x * session.width)),
      String(Math.round(action.y * session.height)),
    );
  if (action.kind === "swipe")
    args.push(
      "swipe",
      String(Math.round(action.x * session.width)),
      String(Math.round(action.y * session.height)),
      String(Math.round(action.endX * session.width)),
      String(Math.round(action.endY * session.height)),
      "350",
    );
  if (action.kind === "text") {
    for (const text of androidTextCommands(action.text)) {
      await runText(androidTools().adb, [...args, "text", text]);
    }
    return;
  }
  if (action.kind === "home") args.push("keyevent", "KEYCODE_HOME");
  if (action.kind === "back") args.push("keyevent", "KEYCODE_BACK");
  await runText(androidTools().adb, args);
}

export async function disconnectPreview(id: string): Promise<void> {
  const session = getSession(id);
  if (session.ticket) await runQueue(["release", "--ticket", session.ticket]);
  sessions.delete(id);
}

export async function disconnectAllPreviews(): Promise<void> {
  for (const id of sessions.keys()) await disconnectPreview(id);
}
