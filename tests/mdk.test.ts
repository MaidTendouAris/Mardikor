import assert from "node:assert/strict";
import { after, test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { parse } from "smol-toml";
import * as mdk from "../electron/mdk";
import { AppState } from "../electron/state";

fs.mkdirSync(".test-artifacts", { recursive: true });
const root = fs.mkdtempSync(path.resolve(".test-artifacts/mdk-tests-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const target = (name: string) => path.join(root, name);
function fixture(
  name: string,
  mode: string,
  files: Record<string, string | Buffer>,
  mimetypeFirst = true,
) {
  const zip = new AdmZip(undefined, { noSort: true });
  if (mimetypeFirst) {
    zip.addFile("mimetype", Buffer.from(mdk.MDK_MIMETYPE));
    zip.getEntry("mimetype")!.header.method = 0;
  }
  for (const [name, content] of Object.entries(files))
    zip.addFile(name, Buffer.from(content));
  if (!mimetypeFirst) zip.addFile("mimetype", Buffer.from(mdk.MDK_MIMETYPE));
  const file = target(name);
  fs.writeFileSync(file, Buffer.concat([Buffer.from(mode), zip.toBuffer()]));
  return file;
}

test("writer emits exactly two mode bytes and a first, STORE mimetype entry", () => {
  const file = target("new.mdk");
  mdk.createMdkProject(file, "01");
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.subarray(0, 2).toString(), "01");
  assert.equal(bytes.readUInt32LE(2), 0x04034b50);
  assert.equal(bytes.readUInt16LE(10), 0);
  const zip = new AdmZip(bytes.subarray(2));
  assert.equal(zip.getEntries()[0].entryName, "mimetype");
  assert.equal(zip.readAsText("mimetype"), mdk.MDK_MIMETYPE);
  assert.equal(mdk.validateMdk(file).valid, true);
});

test("minimal empty project, omitted settings/meta, lowercase and reserved modes remain compatible", () => {
  const file = fixture("minimal.mdk", "aF", {
    "contents.toml": "schema_version = 1\n",
  });
  const project = mdk.openMdkProject(file);
  assert.equal(project.mode, "AF");
  assert.deepEqual(project.contents.entries, []);
  assert.equal(project.settings.appearance.font_size, 16);
  assert.equal(mdk.validateMdk(file).valid, true);
  assert(project.readonly);
  assert.throws(() => mdk.addMdkEntry(file, ""));
  mdk.setMdkMode(file, "00");
  mdk.addMdkEntry(file, "");
  assert.equal(
    mdk.openMdkProject(file).contents.entries[0].path,
    "markdown/001.md",
  );
});

test("partial settings fill defaults and preserve extension fields during structured edits", () => {
  const file = fixture("partial.mdk", "00", {
    "contents.toml": "schema_version = 1\n",
    "settings.toml":
      'schema_version = 1\n[appearance]\nfont_size = 21\n[extension]\ncustom = "keep me"\n',
  });
  const project = mdk.openMdkProject(file);
  assert.equal(project.settings.appearance.font_size, 21);
  assert.equal(project.settings.layout.page_width, 720);
  project.settings.appearance.font_size = 22;
  mdk.updateMdkSettings(file, project.settings);
  assert.equal(
    (
      parse(mdk.readMdkTextFile(file, "settings.toml").content).extension as {
        custom: string;
      }
    ).custom,
    "keep me",
  );
});

test("raw source, CRLF, comments and unknown files survive save/export byte for byte", () => {
  const original = "# 中文\r\n\r\n:::note\r\n未识别的扩展语法\r\n:::\r\n";
  const binary = Buffer.from([0, 1, 255, 17]);
  const file = fixture("preserve.mdk", "02", {
    "contents.toml":
      'schema_version = 1\n[[entries]]\nid = "stable"\npath = "markdown/正文.md"\nposition = "1"\n',
    "markdown/正文.md": original,
    "custom/extension.bin": binary,
  });
  assert.equal(mdk.readMdkEntry(file, "stable").markdown, original);
  mdk.saveMdkEntry(file, "stable", original);
  mdk.exportMdk(file, target("preserve-export.mdk"));
  const zip = new AdmZip(
    fs.readFileSync(target("preserve-export.mdk")).subarray(2),
  );
  assert.equal(zip.readAsText("markdown/正文.md"), original);
  assert.deepEqual(zip.readFile("custom/extension.bin"), binary);
  const source =
    '# 注释\r\nschema_version = 1\r\n\r\n[unknown]\r\nx = "保持"\r\n';
  mdk.saveMdkTextFile(file, "settings.toml", source);
  assert.equal(mdk.readMdkTextFile(file, "settings.toml").content, source);
});

test("entry IDs remain stable across Unicode rename/reorder and filename collisions are avoided", () => {
  const file = target("entries.mdk"),
    project = mdk.createMdkProject(file, "01"),
    id = project.contents.entries[0].id;
  mdk.renameMdkEntry(file, id, "第一章.md");
  let loaded = mdk.addMdkEntry(file, "第一章.md");
  assert.equal(loaded.contents.entries[1].path, "markdown/第一章-2.md");
  const second = loaded.contents.entries[1].id;
  loaded = mdk.reorderMdkEntries(file, [
    { id, position: "2.10" },
    { id: second, position: "2.2" },
  ]);
  assert.equal(loaded.contents.entries[0].id, second);
  assert.equal(loaded.contents.entries[1].id, id);
  assert.equal(loaded.contents.entries[1].path, "markdown/第一章.md");
});

test("adding and deleting an entry retain existing outline hierarchy", () => {
  const file = target("hierarchy.mdk");
  let project = mdk.createMdkProject(file, "01");
  const first = project.contents.entries[0].id;
  project = mdk.addMdkEntry(file, "child.md", first);
  const child = project.contents.entries[1].id;
  mdk.reorderMdkEntries(file, [{ id: child, position: "1.1" }]);
  project = mdk.addMdkEntry(file, "next.md", first);
  assert.equal(
    project.contents.entries.find((e) => e.id === child)?.position,
    "1.1",
  );
  project = mdk.deleteMdkEntry(file, project.contents.entries[2].id);
  assert.equal(
    project.contents.entries.find((e) => e.id === child)?.position,
    "1.1",
  );
  project = mdk.deleteMdkEntry(file, first);
  assert.equal(
    project.contents.entries.find((e) => e.id === child)?.position,
    "1",
  );
});

test("invalid source or outline fails atomically without changing the existing file", () => {
  const file = target("atomic.mdk"),
    project = mdk.createMdkProject(file, "01"),
    before = fs.readFileSync(file);
  for (const source of [
    "schema_version = 2",
    'schema_version = 1\n[[entries]]\nid=""\npath="markdown/missing.md"\nposition="1"',
    "not valid [",
  ]) {
    assert.throws(() => mdk.saveMdkTextFile(file, "contents.toml", source));
    assert.deepEqual(fs.readFileSync(file), before);
  }
  assert.throws(() =>
    mdk.reorderMdkEntries(file, [
      { id: project.contents.entries[0].id, position: "1.1.1.1.1.1.1" },
    ]),
  );
  assert.throws(() => mdk.saveMdkTextFile(file, "mimetype", "wrong"));
  assert.deepEqual(fs.readFileSync(file), before);
});

test("binary source is rejected and resource import avoids filename collisions", () => {
  const file = target("resources.mdk");
  mdk.createMdkProject(file, "01");
  fs.writeFileSync(target("asset.bin"), Buffer.from([0, 255, 123, 12]));
  const first = mdk.importMdkResource(file, target("asset.bin"), "other");
  const second = mdk.importMdkResource(file, target("asset.bin"), "other");
  assert.equal(first.path, "resources/other/asset.bin");
  assert.equal(second.path, "resources/other/asset-2.bin");
  assert.throws(() => mdk.readMdkTextFile(file, first.path));
  assert.equal(
    mdk.validateMdk(file).issues.filter((i) => i.code === "W_RESOURCE_ORPHAN")
      .length,
    2,
  );
});

test("missing Markdown resources permit ordinary saves but block strict delivery", () => {
  const file = fixture("missing-resource.mdk", "01", {
    "contents.toml":
      'schema_version=1\n[[entries]]\nid="entry"\npath="markdown/001.md"\nposition="1"',
    "markdown/001.md": "![封面](../resources/image/missing.png)",
  });
  assert.equal(mdk.openMdkProject(file).contents.entries.length, 1);
  assert.equal(mdk.validateMdk(file).valid, false);
  assert.throws(() => mdk.exportMdk(file, target("must-not-exist.mdk")));
  mdk.saveMdkEntry(
    file,
    "entry",
    "![仍然缺失](../resources/image/missing.png)",
  );
  assert.equal(mdk.validateMdk(file).valid, false);
  mdk.saveMdkEntry(file, "entry", "# 已修复");
  assert.equal(mdk.validateMdk(file).valid, true);
});

test("wrong mimetype position, corrupt ZIP, unsafe paths and future schema are rejected", () => {
  assert.equal(
    mdk.validateMdk(
      fixture(
        "bad-mimetype.mdk",
        "00",
        { "contents.toml": "schema_version=1" },
        false,
      ),
    ).valid,
    false,
  );
  fs.writeFileSync(target("broken.mdk"), "00not-a-zip");
  assert.equal(mdk.validateMdk(target("broken.mdk")).valid, false);
  for (const name of [
    "../outside.txt",
    "/absolute",
    "C:/drive",
    "resources\\bad",
    "a/../b",
    "a//b",
    "",
  ])
    assert.throws(() => mdk.validatePath(name));
  assert.throws(() =>
    mdk.openMdkProject(
      fixture("future.mdk", "00", { "contents.toml": "schema_version=2" }),
    ),
  );
  const futureSettings = mdk.openMdkProject(
    fixture("future-settings.mdk", "00", {
      "contents.toml": "schema_version=1",
      "settings.toml": "schema_version=2",
    }),
  );
  assert(futureSettings.settings_readonly);
});

test("malformed settings warn and use defaults, while future settings prevent export", () => {
  const file = fixture("bad-settings.mdk", "00", {
    "contents.toml": "schema_version=1",
    "settings.toml": "[[broken",
  });
  assert.equal(mdk.openMdkProject(file).settings.appearance.font_size, 16);
  assert.equal(mdk.validateMdk(file).valid, false);
  assert.equal(mdk.validateMdk(file).issues[0].code, "E_SETTINGS");
});

test("metadata export follows include_meta and other extension data remains intact", () => {
  const file = fixture("meta.mdk", "00", {
    "contents.toml": "schema_version=1",
    "meta/annotations.json": "{}",
    "extension.txt": "keep",
  });
  const output = target("no-meta.mdk");
  const preferences = mdk.openMdkProject(file).settings;
  preferences.export.include_meta = false;
  mdk.updateMdkSettings(file, preferences);
  assert.throws(() => mdk.exportMdk(file, output));
  mdk.exportMdk(file, output, mdk.planMdkExport(file).revision);
  assert(
    !mdk.openMdkProject(output).files.some((f) => f.path.startsWith("meta/")),
  );
  assert.equal(mdk.readMdkTextFile(output, "extension.txt").content, "keep");
  const settings = mdk.openMdkProject(file).settings;
  settings.export.include_meta = true;
  mdk.updateMdkSettings(file, settings);
  mdk.exportMdk(file, target("with-meta.mdk"));
  assert.equal(
    mdk.readMdkTextFile(target("with-meta.mdk"), "meta/annotations.json")
      .content,
    "{}",
  );
});

test("pack/unpack roundtrip and existing output files are protected", () => {
  const file = target("pack-source.mdk");
  mdk.createMdkProject(file, "02");
  const directory = target("unpacked");
  mdk.unpackMdk(file, directory);
  assert.equal(
    fs.readFileSync(path.join(directory, ".mdk-mode"), "utf8"),
    "02",
  );
  const output = target("repacked.mdk");
  mdk.packMdk(directory, output, "02");
  assert.equal(
    mdk.readMdkEntry(output, mdk.openMdkProject(output).contents.entries[0].id)
      .markdown,
    "# 001\n\n",
  );
  assert.throws(() => mdk.unpackMdk(file, directory));
});

test("application preferences and real recent projects persist independently of MDK files", () => {
  const directory = target("app-data"),
    state = new AppState(directory);
  assert.deepEqual(state.recent(), []);
  state.remember(target("new.mdk"), "01");
  state.remember(target("new.mdk"), "02");
  assert.equal(state.recent().length, 1);
  state.preferences({
    autosave: false,
    autosaveInterval: 60,
    directorySyncThreshold: 300,
  });
  const restored = new AppState(directory);
  assert.equal(restored.recent()[0].mode, "02");
  assert.equal(restored.preferences().autosaveInterval, 60);
  assert.throws(() =>
    restored.preferences({
      autosave: true,
      autosaveInterval: 0,
      directorySyncThreshold: 200,
    }),
  );
});

test("external file view defaults migrate safely and persist without being reset by legacy preference updates", () => {
  const directory = target("open-view-preferences"),
    state = new AppState(directory);
  assert.equal(state.preferences().externalOpenView, "preview");
  state.preferences({ ...state.preferences(), externalOpenView: "write" });
  const restored = new AppState(directory);
  assert.equal(restored.preferences().externalOpenView, "write");
  restored.preferences({
    autosave: false,
    autosaveInterval: 60,
    directorySyncThreshold: 200,
  });
  assert.equal(new AppState(directory).preferences().externalOpenView, "write");
  assert.throws(() =>
    restored.preferences({
      ...restored.preferences(),
      externalOpenView: "invalid" as "preview",
    }),
  );
  assert.equal(new AppState(directory).preferences().externalOpenView, "write");
  const file = path.join(directory, "workspace.json"),
    saved = JSON.parse(fs.readFileSync(file, "utf8"));
  delete saved.preferences.externalOpenView;
  fs.writeFileSync(file, JSON.stringify(saved));
  assert.equal(
    new AppState(directory).preferences().externalOpenView,
    "preview",
  );
  saved.preferences.externalOpenView = "future-value";
  fs.writeFileSync(file, JSON.stringify(saved));
  assert.equal(
    new AppState(directory).preferences().externalOpenView,
    "preview",
  );
});

test("Markdown code examples are not interpreted as resource references", () => {
  const file = target("code-reference.mdk");
  const project = mdk.createMdkProject(file, "01");
  const source =
    "```md\n![example](../resources/image/example.png)\n```\n\n`![inline](../resources/image/inline.png)`\n";
  mdk.saveMdkEntry(file, project.contents.entries[0].id, source);
  assert.equal(mdk.validateMdk(file).valid, true);
});

test("archive path traversal, duplicate names and oversized declarations fail before extraction", () => {
  const file = fixture("unsafe-archive.mdk", "00", {
    "contents.toml": "schema_version=1",
    "safe/item.txt": "x",
  });
  const replaceName = (buffer: Buffer, from: string, to: string) => {
    assert.equal(from.length, to.length);
    let offset = 0;
    while ((offset = buffer.indexOf(Buffer.from(from), offset)) !== -1) {
      buffer.write(to, offset);
      offset += to.length;
    }
  };
  let data = fs.readFileSync(file);
  replaceName(data, "safe/item.txt", ".././evil.txt");
  fs.writeFileSync(file, data);
  assert.equal(mdk.validateMdk(file).valid, false);
  const duplicate = fixture("duplicate.mdk", "00", {
    "contents.toml": "schema_version=1",
    "safe/item.txt": "a",
    "aaaa/item.txt": "b",
  });
  data = fs.readFileSync(duplicate);
  replaceName(data, "aaaa/item.txt", "safe/item.txt");
  fs.writeFileSync(duplicate, data);
  assert.equal(mdk.validateMdk(duplicate).valid, false);
  const oversized = fixture("oversized.mdk", "00", {
    "contents.toml": "schema_version=1",
  });
  data = fs.readFileSync(oversized);
  const central = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  data.writeUInt32LE(64 * 1024 * 1024 + 1, central + 24);
  fs.writeFileSync(oversized, data);
  assert.equal(mdk.validateMdk(oversized).valid, false);
});

test("media imports check the real file signature before updating an archive", () => {
  const file = target("media.mdk");
  mdk.createMdkProject(file, "00");
  fs.writeFileSync(target("fake.png"), "<html>not an image</html>");
  const before = fs.readFileSync(file);
  assert.throws(() => mdk.importMdkResource(file, target("fake.png"), "image"));
  assert.deepEqual(fs.readFileSync(file), before);
});

test("the physical file manager creates UTF-8 files, folders and indexed Markdown documents", () => {
  const file = target("explorer.mdk");
  mdk.createMdkProject(file, "01");
  mdk.createProjectDirectory(file, "markdown/第二卷");
  let project = mdk.createTextFile(
    file,
    "markdown/第二卷/正文.md",
    "# 正文\r\n",
  );
  assert(
    !project.contents.entries.some((e) => e.path === "markdown/第二卷/正文.md"),
  );
  project = mdk.addMdkReference(file, "markdown/第二卷/正文.md");
  const entry = project.contents.entries.find(
    (e) => e.path === "markdown/第二卷/正文.md",
  )!;
  assert(entry.id);
  assert(
    project.files.find((f) => f.path === "markdown/第二卷")?.kind ===
      "directory",
  );
  mdk.createTextFile(file, "meta/annotations.json", '{"unknown":[1,2]}\n');
  assert(
    mdk
      .openMdkProject(file)
      .files.find((f) => f.path === "meta/annotations.json")?.is_text,
  );
  project = mdk.renameProjectFile(file, "markdown/第二卷", "markdown/第二册");
  assert.equal(
    project.contents.entries.find((e) => e.id === entry.id)?.path,
    "markdown/第二册/正文.md",
  );
  assert.equal(mdk.readMdkEntry(file, entry.id).markdown, "# 正文\r\n");
  mdk.deleteProjectFile(file, "meta");
  assert(
    !mdk.openMdkProject(file).files.some((f) => f.path.startsWith("meta/")),
  );
  assert.throws(() => mdk.deleteProjectFile(file, "contents.toml"));
  assert.throws(() => mdk.renameProjectFile(file, "mimetype", "mime.txt"));
});

test("all v1 settings fields and reserved modes can be edited without discarding extensions", () => {
  const file = target("full-settings.mdk");
  const project = mdk.createMdkProject(file, "01");
  const settings = project.settings;
  settings.appearance.theme = "serif";
  settings.preview.show_toc = false;
  settings.preview.render_containers = false;
  settings.mode.book.toc_depth = 5;
  settings.mode.book.split_by_heading = true;
  settings.mode.comic.reading_direction = "rtl";
  settings.mode.comic.spread_mode = "double";
  mdk.updateMdkSettings(file, settings);
  mdk.setMdkMode(file, "aB");
  const loaded = mdk.openMdkProject(file);
  assert.equal(loaded.mode, "AB");
  assert.equal(loaded.settings.mode.book.toc_depth, 5);
  assert.equal(loaded.settings.mode.comic.reading_direction, "rtl");
  assert(mdk.validateMdk(file).issues.some((i) => i.code === "W_MODE_UNKNOWN"));
});

test("file manager preserves references on unsafe rename and permits explicit incomplete deletion", () => {
  const file = target("resource-delete.mdk");
  const project = mdk.createMdkProject(file, "00");
  fs.writeFileSync(target("attachment.txt"), "附件");
  mdk.importMdkResource(file, target("attachment.txt"), "other");
  mdk.saveMdkEntry(
    file,
    project.contents.entries[0].id,
    "[附件](../resources/other/attachment.txt)",
  );
  const original = fs.readFileSync(file);

  assert.throws(() =>
    mdk.renameProjectFile(
      file,
      "resources/other/attachment.txt",
      "resources/other/new.txt",
    ),
  );
  assert.deepEqual(fs.readFileSync(file), original);
  mdk.deleteProjectFile(file, "resources/other/attachment.txt");
  assert.equal(mdk.validateMdk(file).valid, false);
});

test("export preferences enforce overwrite protection and preserve stable IDs when normalizing names", () => {
  const file = target("export-preferences.mdk"),
    output = target("export-existing.mdk");
  let project = mdk.createMdkProject(file, "01");
  const id = project.contents.entries[0].id;
  mdk.renameMdkEntry(file, id, "第一章.md");
  project = mdk.openMdkProject(file);
  project.settings.export.preserve_source_names = false;
  mdk.updateMdkSettings(file, project.settings);
  mdk.exportMdk(file, output);
  assert.equal(mdk.openMdkProject(output).contents.entries[0].id, id);
  assert.equal(
    mdk.openMdkProject(output).contents.entries[0].path,
    "markdown/第一章.md",
  );
  assert(
    mdk
      .planMdkExport(file)
      .report.issues.some((i) => i.code === "W_NAMES_RETAINED"),
  );
  assert.throws(() => mdk.exportMdk(file, output));
  project.settings.export.mdk.overwrite_existing = true;
  mdk.updateMdkSettings(file, project.settings);
  mdk.exportMdk(file, output);
  assert.equal(mdk.validateMdk(output).valid, true);
});

test("book heading split creates sibling documents atomically, retaining original ID, descendants and resource paths", () => {
  const file = target("split-book.mdk");
  let project = mdk.createMdkProject(file, "01");
  const id = project.contents.entries[0].id;
  project = mdk.addMdkEntry(file, "child.md");
  const child = project.contents.entries.find((e) => e.id !== id)!;
  mdk.reorderMdkEntries(file, [{ id: child.id, position: "1.1" }]);
  const source = "# 一\r\n\r\n正文\r\n\r\n# 二\r\n\r\n后文\r\n";
  mdk.saveMdkEntry(file, id, source);
  const before = fs.readFileSync(file);
  assert.throws(() => mdk.splitMdkEntry(file, id));
  assert.deepEqual(fs.readFileSync(file), before);
  project = mdk.openMdkProject(file);
  project.settings.mode.book.split_by_heading = true;
  mdk.updateMdkSettings(file, project.settings);
  project = mdk.splitMdkEntry(file, id);
  const added = project.contents.entries.find(
    (e) => ![id, child.id].includes(e.id),
  )!;
  assert.equal(
    project.contents.entries.find((e) => e.id === id)?.path,
    "markdown/001.md",
  );
  assert.equal(
    project.contents.entries.find((e) => e.id === child.id)?.position,
    "1.1",
  );
  assert.equal(added.position, "2");
  assert.equal(
    mdk.readMdkEntry(file, id).markdown +
      mdk.readMdkEntry(file, added.id).markdown,
    source,
  );
});

test("project font references are checked and binary extensions are never created as source text", () => {
  const file = target("font-reference.mdk");
  const project = mdk.createMdkProject(file, "00");
  project.settings.appearance.font_family = "resources/font/missing.ttf";
  mdk.updateMdkSettings(file, project.settings);
  assert.equal(mdk.validateMdk(file).valid, false);
  assert.throws(() =>
    mdk.createTextFile(file, "resources/other/file.pdf", "plain text"),
  );
});
