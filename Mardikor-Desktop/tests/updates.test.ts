import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { UpdateService, updateInterval } from "../electron/update-service";
import { AppState } from "../electron/state";
import fs from "node:fs";
import path from "node:path";
import type { AppUpdater } from "electron-updater";

class Updater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = true;
  allowDowngrade = true;
  checks = 0;
  downloads = 0;
  installs = 0;
  installOptions?: [boolean | undefined, boolean | undefined];
  nextVersion = "0.2.0";
  networkError = false;
  async checkForUpdates() {
    this.checks++;
    await Promise.resolve();
    if (this.networkError) throw Error("offline");
    this.emit("update-available", {
      version: this.nextVersion,
      releaseNotes: "<script>not executable</script>",
    });
    return {};
  }
  async downloadUpdate() {
    this.downloads++;
    this.emit("download-progress", { percent: 42 });
    this.emit("update-downloaded", {});
    return [];
  }
  quitAndInstall(silent?: boolean, restart?: boolean) {
    this.installs++;
    this.installOptions = [silent, restart];
  }
}
function fixture(canInstall = true) {
  const client = new Updater();
  const time = { now: updateInterval * 10, checked: 0, enabled: true };
  const store = {
    enabled: () => time.enabled,
    lastChecked: () => time.checked,
    checked: (at: number) => {
      time.checked = at;
    },
  };
  const make = () =>
    new UpdateService(
      client as unknown as AppUpdater,
      store,
      "0.1.0",
      canInstall,
      () => {},
      () => time.now,
    );
  return { client, time, store, make, service: make() };
}
test("automatic checks occur once per 24 hours across services; manual checks work when disabled", async () => {
  const f = fixture();
  await Promise.all([
    f.service.automatic(),
    f.service.automatic(),
    f.service.check(),
  ]);
  assert.equal(f.client.checks, 1);
  assert.equal(f.client.downloads, 0);
  assert.equal(f.client.installs, 0);
  assert.equal(f.client.autoDownload, false);
  assert.equal(f.client.autoInstallOnAppQuit, false);
  assert.equal(f.client.allowDowngrade, false);
  await f.make().automatic();
  assert.equal(f.client.checks, 1);
  f.time.now += updateInterval - 1;
  await f.service.automatic();
  assert.equal(f.client.checks, 1);
  f.time.now++;
  await f.service.automatic();
  assert.equal(f.client.checks, 2);
  f.time.enabled = false;
  f.time.now += updateInterval;
  await f.service.automatic();
  assert.equal(f.client.checks, 2);
  await f.service.check();
  assert.equal(f.client.checks, 3);
});
test("offline checks are bounded, clock rollback recovers, and state write errors do not escape", async () => {
  const f = fixture();
  f.client.networkError = true;
  await f.service.automatic();
  assert.equal(f.service.status().phase, "error");
  await f.service.automatic();
  assert.equal(f.client.checks, 1);
  f.time.now--;
  await f.service.automatic();
  assert.equal(f.client.checks, 2);
  f.store.checked = () => {
    throw Error("disk full");
  };
  await f.service.check();
  assert.match(f.service.status().message, /disk full/);
});
test("downloads and installation require separate actions; cancelled preparation keeps the app open", async () => {
  const f = fixture();
  await assert.rejects(() => f.service.install(async () => true), /下载/);
  await f.service.check();
  assert.equal(f.client.downloads, 0);
  await Promise.all([f.service.download(), f.service.download()]);
  assert.equal(f.client.downloads, 1);
  assert.equal(f.service.status().phase, "downloaded");
  assert.equal(f.client.installs, 0);
  await f.service.install(async () => false);
  assert.equal(f.client.installs, 0);
  assert.equal(f.service.status().phase, "downloaded");
  await f.service.check();
  assert.equal(f.service.status().phase, "downloaded");
  await f.service.install(async () => true);
  assert.equal(f.client.installs, 1);
  assert.deepEqual(f.client.installOptions, [true, true]);
});
test("a newer release needs a new explicit download and portable builds use the release page", async () => {
  const f = fixture();
  await f.service.check();
  await f.service.download();
  f.client.nextVersion = "0.3.0";
  await f.service.check();
  assert.equal(f.service.status().phase, "available");
  assert.equal(f.client.downloads, 1);
  await assert.rejects(() => f.service.install(async () => true), /下载/);
  const portable = fixture(false);
  await portable.service.check();
  assert.throws(() => portable.service.download(), /发布页/);
  assert.equal(portable.client.downloads, 0);
});
test("update preferences and daily check timestamps persist without changing document settings", () => {
  fs.mkdirSync(".test-artifacts", { recursive: true });
  const directory = fs.mkdtempSync(
    path.resolve(".test-artifacts/update-state-"),
  );
  const state = new AppState(directory);
  assert.equal(state.preferences().autoCheckUpdates, true);
  state.preferences({ ...state.preferences(), autoCheckUpdates: false });
  state.updateCheck(12345);
  const restart = new AppState(directory);
  assert.equal(restart.preferences().autoCheckUpdates, false);
  assert.equal(restart.updateCheck(), 12345);
});
