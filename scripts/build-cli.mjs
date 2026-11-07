import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = "build-output/cli";
const destination = path.join(root, "package");
const { version, engines, repository } = JSON.parse(
  await fs.readFile("package.json", "utf8"),
);
await fs.mkdir(path.join(destination, "bin"), { recursive: true });
const executable = path.join(destination, "bin", "mardikor.cjs");
await build({
  entryPoints: ["cli/mardikor.ts"],
  outfile: executable,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  banner: { js: "#!/usr/bin/env node" },
});
await fs.chmod(executable, 0o755);
await fs.writeFile(
  path.join(destination, "package.json"),
  JSON.stringify(
    {
      name: "mardikor-cli",
      version,
      description: "Headless command-line editor for Mardikor MDK projects",
      license: "GPL-3.0-only",
      repository: repository ?? "https://github.com/MaidTendouAris/Mardikor",
      engines,
      bin: { mardikor: "bin/mardikor.cjs" },
    },
    null,
    2,
  ) + "\n",
);
await Promise.all([
  fs.copyFile("LICENSE", path.join(destination, "LICENSE")),
  fs.copyFile(
    "docs/THIRD_PARTY_NOTICES.txt",
    path.join(destination, "THIRD_PARTY_NOTICES.txt"),
  ),
  fs.copyFile("docs/CLI.md", path.join(destination, "README.md")),
]);
if (process.platform === "win32") {
  const csc = path.join(
    process.env.WINDIR,
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  );
  execFileSync(
    csc,
    [
      "/nologo",
      "/optimize+",
      "/target:exe",
      "/out:" + path.resolve(root, "mardikor.exe"),
      path.resolve("build-scripts/cli-launcher.cs"),
    ],
    { stdio: "inherit" },
  );
}
