import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const { version } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const directory = path.resolve(process.argv[2] || "release");
const files = (await readdir(directory, { withFileTypes: true }))
  .filter(
    (entry) =>
      entry.isFile() &&
      entry.name.includes(version) &&
      /\.(exe|AppImage|tar\.gz|dmg|zip)$/.test(entry.name),
  )
  .map((entry) => entry.name)
  .sort();
if (!files.length)
  throw new Error(`No ${version} distributables found in ${directory}`);
const lines = [];
for (const file of files) {
  if (/[\r\n\\]/.test(file)) throw new Error("Unsafe artifact filename.");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path.join(directory, file)))
    hash.update(chunk);
  lines.push(`${hash.digest("hex")}  ${file}`);
}
await writeFile(
  path.join(directory, "SHA256SUMS.txt"),
  lines.join("\n") + "\n",
);
console.log(
  `Wrote SHA-256 checksums for ${files.length} Talos ${version} files.`,
);
