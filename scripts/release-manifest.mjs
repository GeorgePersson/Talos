import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const { version } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const args = process.argv.slice(2);
const githubAssets = args.includes("--github-assets");
const directory = path.resolve(
  args.find((arg) => !arg.startsWith("--")) || "release",
);
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
const publishedNames = new Set();
for (const file of files) {
  if (/[\r\n\\]/.test(file)) throw new Error("Unsafe artifact filename.");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path.join(directory, file)))
    hash.update(chunk);
  // GitHub converts spaces in uploaded asset names to dots. Local manifests
  // retain the names on disk; release manifests must match actual downloads.
  const filename = githubAssets ? file.replaceAll(" ", ".") : file;
  if (publishedNames.has(filename))
    throw new Error("Duplicate release asset name.");
  publishedNames.add(filename);
  lines.push(`${hash.digest("hex")}  ${filename}`);
}
await writeFile(
  path.join(directory, "SHA256SUMS.txt"),
  lines.join("\n") + "\n",
);
console.log(
  `Wrote SHA-256 checksums for ${files.length} Talos ${version} files.`,
);
