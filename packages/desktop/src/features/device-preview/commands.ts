import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import { z } from "zod";

const execute = promisify(execFile);
const envelope = z.object({ ok: z.boolean(), message: z.string().optional() }).loose();

export function androidTools() {
  const root =
    process.env.ANDROID_HOME ??
    process.env.ANDROID_SDK_ROOT ??
    path.join(homedir(), "Library/Android/sdk");
  const adb = path.join(root, "platform-tools/adb");
  const emulator = path.join(root, "emulator/emulator");
  if (!existsSync(adb)) throw new Error("Android SDK platform-tools are not installed.");
  return { adb, emulator };
}

export function simulatorEnvironment(): NodeJS.ProcessEnv {
  const resources = process.resourcesPath;
  const root = app.isPackaged ? resources : path.resolve(app.getAppPath(), "../..");
  const adapter = app.isPackaged
    ? path.join(resources, "bin/paseo-simq-backend")
    : path.join(root, "packages/desktop/bin/paseo-simq-backend");
  const serveSim = app.isPackaged
    ? path.join(resources, "serve-sim/dist/serve-sim.js")
    : path.join(root, "node_modules/serve-sim/dist/serve-sim.js");
  const node = app.isPackaged
    ? path.join(resources, "../Frameworks/Paseo Helper.app/Contents/MacOS/Paseo Helper")
    : process.execPath;
  return {
    ...process.env,
    ORCA_CLI_COMMAND: adapter,
    PASEO_SERVE_SIM_CLI: serveSim,
    PASEO_SIMULATOR_NODE: node,
  };
}

export async function runText(
  executable: string,
  args: string[],
  timeout = 30000,
): Promise<string> {
  const { stdout } = await execute(executable, args, { timeout, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

export async function runQueue(args: string[], timeout = 30000): Promise<unknown> {
  const executable = path.join(homedir(), ".local/bin/simq");
  if (!existsSync(executable))
    throw new Error("Install simq to coordinate access to the shared iOS Simulator.");
  let stdout: string;
  try {
    const result = await execute(executable, args, {
      env: simulatorEnvironment(),
      timeout,
      maxBuffer: 8 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch {
    throw new Error(
      "Simulator queue operation failed. Check simq recover inspect; blocked state is never cleared automatically.",
    );
  }
  const result: unknown = JSON.parse(stdout);
  const parsed = envelope.parse(result);
  if (!parsed.ok) throw new Error(parsed.message ?? "The simulator queue rejected this operation.");
  return result;
}

export async function captureAndroid(serial: string): Promise<Buffer> {
  const { stdout } = await execute(
    androidTools().adb,
    ["-s", serial, "exec-out", "screencap", "-p"],
    {
      timeout: 15000,
      maxBuffer: 16 * 1024 * 1024,
      encoding: "buffer",
    },
  );
  return stdout;
}

export async function bootAndroid(name: string): Promise<void> {
  const tool = androidTools().emulator;
  if (!existsSync(tool)) throw new Error("Android emulator executable is not installed.");
  const child = spawn(tool, ["-avd", name, "-no-snapshot-save", "-no-boot-anim", "-no-window"], {
    detached: true,
    stdio: "ignore",
  });
  const ready = once(child, "spawn");
  child.unref();
  await ready;
}
