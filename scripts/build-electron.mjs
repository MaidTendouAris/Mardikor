import { build } from "esbuild";
import fs from "node:fs";
import { createHash } from "node:crypto";

const publicationSources = [
  "electron/publication.ts",
  "electron/publication-render.ts",
  "electron/publication-runtime.ts",
  "electron/pdf-text.ts",
  "electron/epub.ts",
  "electron/mdk.ts",
  "electron/markdown-file.ts",
  "electron/media.ts",
  "electron/archive.ts",
  "shared/publication.ts",
  "shared/markdown-parser.ts",
  "shared/defaults.ts",
  "shared/schema.ts",
  "shared/references.ts",
  "shared/tree.ts",
  "shared/outline.ts",
  "package-lock.json",
];

export const options = {
  entryPoints: ["electron/main.ts", "electron/preload.ts"],
  outdir: "dist-electron",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["electron", "electron-updater"],
  sourcemap: true,
  plugins: [
    {
      name: "publication-version",
      setup(build) {
        build.onStart(() => {
          const digest = createHash("sha256");
          for (const file of publicationSources) {
            digest.update(file);
            digest.update("\0");
            digest.update(fs.readFileSync(file));
            digest.update("\0");
          }
          fs.mkdirSync("assets/export", { recursive: true });
          fs.writeFileSync(
            "assets/export/renderer.json",
            JSON.stringify(
              { version: 1, sha256: digest.digest("hex") },
              null,
              2,
            ) + "\n",
          );
        });
      },
    },
  ],
};
await build(options);
