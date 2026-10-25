import { spawnSync } from "node:child_process";

const [namespace, operation, value, ...rest] = process.argv.slice(2);
const args = process.argv.slice(4);
const deviceIndex = args.indexOf("--device");
const device = deviceIndex >= 0 ? args[deviceIndex + 1] : null;
const allowed = ["tap", "type", "gesture", "button"];
const executable = process.env.PASEO_SIMULATOR_NODE;
const cli = process.env.PASEO_SERVE_SIM_CLI;
if (namespace !== "emulator" || !allowed.includes(operation) || !device || !executable || !cli) {
  console.log(JSON.stringify({ ok: false, message: "Invalid queued simulator operation." }));
  process.exit(1);
}
let command;
let input;
if (operation === "type") {
  command = ["type", "--stdin", "--device", device];
  input = value;
} else if (operation === "tap") {
  command = ["tap", value, rest[0], "--device", device];
} else {
  command = [operation, value, "--device", device];
}
const result = spawnSync(executable, [cli, ...command], {
  input,
  encoding: "utf8",
  timeout: 30000,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
});
const ok = result.status === 0 && !result.error;
console.log(
  JSON.stringify({ ok, message: ok ? "Simulator input delivered." : "Simulator input failed." }),
);
process.exit(ok ? 0 : 1);
