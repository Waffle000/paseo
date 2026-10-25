import { spawnSync } from "node:child_process";

const [namespace, operation, value, ...rest] = process.argv.slice(2);
const args = process.argv.slice(4);
const deviceIndex = args.indexOf("--device");
const device = deviceIndex >= 0 ? args[deviceIndex + 1] : null;
const allowed = ["prepare", "stop", "tap", "type", "gesture", "button"];
const executable = process.env.PASEO_SIMULATOR_NODE;
const cli = process.env.PASEO_SERVE_SIM_CLI;
if (namespace !== "emulator" || !allowed.includes(operation) || !device || !executable || !cli) {
  console.log(JSON.stringify({ ok: false, message: "Invalid queued simulator operation." }));
  process.exit(1);
}

function run(command, input) {
  const result = spawnSync(executable, [cli, ...command], {
    input,
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  if (result.status !== 0 || result.error) throw new Error("Simulator input backend failed.");
  return result.stdout;
}

try {
  let result;
  if (operation === "prepare") {
    const state = JSON.parse(run(["--list", device]));
    if (typeof state.running !== "boolean") throw new Error("Invalid transport state.");
    if (!state.running) run(["--no-preview", "--detach", "--quiet", device]);
    result = { owned: !state.running };
  } else if (operation === "stop") {
    run(["--kill", device]);
  } else if (operation === "type") {
    run(["type", "--stdin", "--device", device], value);
  } else if (operation === "tap") {
    run(["tap", value, rest[0], "--device", device]);
  } else if (operation === "gesture") {
    const steps = JSON.parse(value);
    if (!Array.isArray(steps)) throw new Error("Expected a gesture sequence.");
    for (const step of steps) run(["gesture", JSON.stringify(step), "--device", device]);
  } else {
    run(["button", value, "--device", device]);
  }
  console.log(JSON.stringify({ ok: true, result }));
} catch {
  console.log(JSON.stringify({ ok: false, message: `Simulator ${operation} failed.` }));
  process.exit(1);
}
