import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { load } from "js-yaml";

const root = path.resolve("build-output/electron");
const { version } = JSON.parse(await fs.readFile("package.json", "utf8"));
const installer = `Mardikor-Setup-${version}-x64.exe`;
const portable = `Mardikor-Portable-${version}-x64.exe`;
const metadata = load(await fs.readFile(path.join(root, "latest.yml"), "utf8"));
if (metadata.version !== version || metadata.path !== installer)
  throw new Error("Release metadata does not match the version/installer.");
const bytes = await fs.readFile(path.join(root, installer));
const hash = createHash("sha512").update(bytes).digest("base64");
if (
  hash !== metadata.sha512 ||
  !metadata.files.some(
    (file) =>
      file.url === installer &&
      file.sha512 === hash &&
      file.size === bytes.length,
  )
)
  throw new Error("Update manifest checksum/size mismatch.");
const names = [installer, `${installer}.blockmap`, portable, "latest.yml"];
const sums = [];
for (const name of names) {
  const bytes = await fs.readFile(path.join(root, name));
  sums.push(`${createHash("sha256").update(bytes).digest("hex")}  ${name}`);
}
await fs.writeFile(path.join(root, "CHECKSUMS.sha256"), sums.join("\n") + "\n");
console.log("Verified update feed and wrote release checksums.");
