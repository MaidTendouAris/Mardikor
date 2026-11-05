import { spawn } from "node:child_process";
import { createServer } from "vite";
import { context } from "esbuild";
import electron from "electron";

const server = await createServer();
await server.listen();
server.printUrls();
const options = {
  entryPoints: ["electron/main.ts", "electron/preload.ts"],
  outdir: "dist-electron",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["electron", "electron-updater"],
  sourcemap: true,
};
const compiler = await context(options);
await compiler.rebuild();
let child;
let restarting = false;
const env = {
  ...process.env,
  VITE_DEV_SERVER_URL: server.resolvedUrls.local[0].replace(/\/$/, ""),
};
delete env.ELECTRON_RUN_AS_NODE;
function launch() {
  child = spawn(electron, ["."], { stdio: "inherit", env, windowsHide: true });
  child.on("exit", () => {
    if (!restarting) void cleanup();
  });
}
await compiler.dispose();
const watcher = await context({
  ...options,
  plugins: [
    {
      name: "restart-electron",
      setup(build) {
        let initial = true;
        build.onEnd((result) => {
          if (result.errors.length) return;
          if (initial) {
            initial = false;
            launch();
            return;
          }
          restarting = true;
          child?.once("exit", () => {
            restarting = false;
            launch();
          });
          child?.kill();
        });
      },
    },
  ],
});
await watcher.watch();
async function cleanup() {
  await watcher.dispose();
  await server.close();
  process.exit();
}
process.on("SIGINT", () => {
  restarting = true;
  child?.kill();
  void cleanup();
});
process.on("SIGTERM", () => {
  restarting = true;
  child?.kill();
  void cleanup();
});
