import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rm, rename, copyFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const version = "32.6.1";
const sha256 = "44dd56958c8408963457dc98f04d2228408ac145c7aa1d8e6895d9c88d5e42aa";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "packages/app/public/drawio");
const marker = path.join(target, ".paseo-version");
if (
  existsSync(marker) &&
  existsSync(path.join(target, "LICENSE")) &&
  existsSync(path.join(target, "js/main.js")) &&
  (await readFile(marker, "utf8")) === `${version}:${sha256}`
)
  process.exit(0);
const cache = path.join(root, ".dev/drawio-cache");
await mkdir(cache, { recursive: true });
const archive = process.env.DRAWIO_ARCHIVE || path.join(cache, `drawio-${version}.war`);
if (!existsSync(archive)) {
  const response = await fetch(
    `https://github.com/jgraph/drawio/releases/download/v${version}/draw.war`,
  );
  if (!response.ok) throw new Error(`draw.io download failed: HTTP ${response.status}`);
  await writeFile(archive, new Uint8Array(await response.arrayBuffer()));
}
const actual = createHash("sha256")
  .update(await readFile(archive))
  .digest("hex");
if (actual !== sha256)
  throw new Error("draw.io archive checksum does not match the pinned release.");
const temporary = `${target}.preparing`;
await rm(temporary, { recursive: true, force: true });
await mkdir(temporary, { recursive: true });
// Keep the full static distribution (including its license notices); Java server code is not used.
execFileSync("unzip", ["-q", archive, "-d", temporary]);
await rm(path.join(temporary, "WEB-INF"), { recursive: true, force: true });
await copyFile(path.join(root, "scripts/drawio-LICENSE.txt"), path.join(temporary, "LICENSE"));
await writeFile(path.join(temporary, ".paseo-version"), `${version}:${sha256}`);
await rm(target, { recursive: true, force: true });
await rename(temporary, target);
console.log(`Prepared offline draw.io ${version} (${sha256}).`);
