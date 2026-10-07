import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const manifest = await readFile(process.argv[2]);
const metadata = JSON.parse(
  (await readFile(process.argv[3], "utf8")).replace(/^\uFEFF/, ""),
);
const assets = new Map(
  metadata.assets.map((asset) => [asset.name, asset.digest]),
);
const lines = manifest.toString("utf8").trim().split(/\r?\n/);
if (assets.size !== lines.length + 1)
  throw new Error("Release asset and checksum counts differ.");
const seen = new Set();
for (const line of lines) {
  const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
  if (
    !match ||
    seen.has(match[2]) ||
    assets.get(match[2]) !== `sha256:${match[1]}`
  )
    throw new Error(`Release checksum or filename mismatch: ${line}`);
  seen.add(match[2]);
}
const digest = createHash("sha256").update(manifest).digest("hex");
if (assets.get("SHA256SUMS.txt") !== `sha256:${digest}`)
  throw new Error("Uploaded checksum manifest differs from the reviewed file.");
console.log(
  `Verified ${lines.length} release files against GitHub's upload digests.`,
);
