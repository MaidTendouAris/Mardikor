import fs from "node:fs";
import path from "node:path";

const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const sections = [
  "Mardikor third-party software notices",
  "Generated from production dependencies in package-lock.json. Electron/Chromium and Noto notices are also distributed with their runtime/font assets.",
];
const seen = new Set();
const archived = JSON.parse(
  fs.readFileSync("docs/licenses/sources.json", "utf8"),
);
for (const [directory, entry] of Object.entries(lock.packages)) {
  if (
    !directory ||
    entry.dev ||
    !fs.existsSync(path.join(directory, "package.json"))
  )
    continue;
  const pkg = JSON.parse(
    fs.readFileSync(path.join(directory, "package.json"), "utf8"),
  );
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const files = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter(
      (file) =>
        file.isFile() &&
        /^(licen[sc]e|copying|notice)(?:[.-]|$)/i.test(file.name),
    )
    .map((file) => file.name)
    .sort();
  sections.push(
    `\n${"=".repeat(72)}\n${key}\nAuthor: ${typeof pkg.author === "string" ? pkg.author : (pkg.author?.name ?? "See upstream")}\nLicense: ${typeof pkg.license === "string" ? pkg.license : JSON.stringify(pkg.license ?? entry.license ?? "See upstream")}`,
  );
  if (files.length) {
    for (const file of files)
      sections.push(
        `\n${file}\n${fs.readFileSync(path.join(directory, file), "utf8").trim()}`,
      );
  } else {
    const source = archived.find(
      (item) => item.name === pkg.name && item.version === pkg.version,
    );
    if (!source) throw new Error(`Missing production license text: ${key}`);
    sections.push(
      `Archived upstream notice: ${source.url}\n\n${fs.readFileSync(path.join("docs/licenses", source.file), "utf8").trim()}`,
    );
  }
}
fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync("docs/THIRD_PARTY_NOTICES.txt", sections.join("\n\n") + "\n");
console.log(
  `Preserved license notices for ${seen.size} production dependencies.`,
);
