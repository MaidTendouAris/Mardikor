const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { extractFile } = require("@electron/asar");

// Run against the actual packaged application, including portable builds.
exports.default = async (context) => {
  const root = context.packager.projectDir;
  const resources = context.packager.getResourcesDir(context.appOutDir);
  const archive = path.join(resources, "app.asar");
  const bundled = [
    "LICENSE",
    "docs/THIRD_PARTY_NOTICES.txt",
    "assets/icon.png",
    "dist-electron/main.cjs",
    "dist-electron/preload.cjs",
    "dist-electron/publication-worker.cjs",
    "dist/index.html",
  ];
  for (const file of fs.readdirSync(path.join(root, "assets/export")))
    bundled.push(`assets/export/${file}`);
  for (const file of fs.readdirSync(path.join(root, "dist/assets")))
    bundled.push(`dist/assets/${file}`);
  bundled.push("node_modules/katex/dist/katex.min.css");
  for (const file of fs.readdirSync(
    path.join(root, "node_modules/katex/dist/fonts"),
  ))
    if (file.endsWith(".woff2"))
      bundled.push(`node_modules/katex/dist/fonts/${file}`);
  for (const file of bundled)
    assert.deepEqual(
      extractFile(archive, path.normalize(file)),
      fs.readFileSync(path.join(root, file)),
      `打包内容不一致：${file}`,
    );

  if (context.electronPlatformName === "win32") {
    for (const file of fs
      .readdirSync(path.join(root, "assets/icons"))
      .filter((file) => file.endsWith(".ico")))
      assert.deepEqual(
        fs.readFileSync(path.join(resources, "icons", file)),
        fs.readFileSync(path.join(root, "assets/icons", file)),
        `文件图标遗漏或过期：${file}`,
      );
  }
  console.log(
    "Verified packaged renderer, main/preload, publication assets and file icons.",
  );
};
