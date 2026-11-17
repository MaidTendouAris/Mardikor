import assert from "node:assert/strict";
import { after, test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import AdmZip from "adm-zip";
import MarkdownIt from "markdown-it";
import { parse } from "smol-toml";
import * as mdk from "../electron/mdk";
import { AppState } from "../electron/state";
import { CONTENTS_MARKDOWN_PATH } from "../shared/mdk";
import { stringifyToml } from "../shared/schema";
import { addArchiveMember } from "../electron/archive";

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
  addArchiveMember(
    zip,
    "mdk.toml",
    Buffer.from(
      files["mdk.toml"] ??
        'format_version = 2\nproject_id = "fixture"\nmode = "' +
          ({ "00": "default", "01": "book", "02": "comic" }[mode] ?? mode) +
          '"\n',
    ),
  );
  for (const [name, content] of Object.entries(files))
    if (name !== "mdk.toml") zip.addFile(name, Buffer.from(content));
  if (!mimetypeFirst) zip.addFile("mimetype", Buffer.from(mdk.MDK_MIMETYPE));
  const file = target(name);
  fs.writeFileSync(file, zip.toBuffer());
  return file;
}

test("writer uses the standard ZIP header and two physical STORE entries", () => {
  const file = target("new.mdk");
  mdk.createMdkProject(file, "01");
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  assert.equal(bytes.readUInt16LE(8), 0);
  const zip = new AdmZip(bytes);
  assert.deepEqual(
    zip
      .getEntries()
      .slice(0, 2)
      .map((entry) => [entry.entryName, entry.header.method]),
    [
      ["mimetype", 0],
      ["mdk.toml", 0],
    ],
  );
  assert.equal(zip.readAsText("mimetype"), mdk.MDK_MIMETYPE);
  assert.equal(mdk.validateMdk(file).valid, true);
});

test("the optional Markdown contents stays in sync and links to unpacked manuscripts", () => {
  const specialPath = "markdown/第一章/说明 [A] (B) #100%.md";
  const file = fixture("contents-guide.mdk", "01", {
    "contents.toml": stringifyToml({
      documents: [
        { id: "intro-doc", path: "markdown/intro.md" },
        { id: "special", path: specialPath },
      ],
      nodes: [
        { id: "intro", kind: "document", document: "intro-doc", order: 1n },
        { id: "part", kind: "group", title: "目录分组", order: 2n },
        {
          id: "later",
          kind: "document",
          document: "special",
          parent: "part",
          order: 10n,
        },
        {
          id: "earlier",
          kind: "document",
          document: "special",
          parent: "part",
          order: 2n,
          title: "索引 [A] *原文*\n&copy;",
        },
      ],
    }),
    "markdown/intro.md": "# Introduction\n",
    [specialPath]: "# 正文\n",
    "markdown/unlisted.md": "# Draft\n",
  });
  const project = mdk.openMdkProject(file);
  assert.equal(project.settings.export.mdk.generate_contents_markdown, false);
  mdk.saveMdkEntry(file, "intro", "# New introduction\n");
  assert(
    !mdk
      .openMdkProject(file)
      .files.some(({ path }) => path === CONTENTS_MARKDOWN_PATH),
  );

  project.settings.export.mdk.generate_contents_markdown = true;
  const saved = mdk.saveMdkSnapshot(file, {
    revision: mdk.fileRevision(file),
    settings: project.settings,
  });
  assert(
    saved.files.find(({ path }) => path === CONTENTS_MARKDOWN_PATH)?.readonly,
  );
  assert.throws(() =>
    mdk.saveMdkTextFile(file, CONTENTS_MARKDOWN_PATH, "manual edit"),
  );
  const contents = (archive: string) =>
    mdk.readMdkTextFile(archive, CONTENTS_MARKDOWN_PATH).content;
  const parser = new MarkdownIt();
  const tokens = parser.parse(contents(file), {});
  const itemDepths = tokens
    .filter((token) => token.type === "list_item_open")
    .map((token) => token.level);
  assert.deepEqual(itemDepths, [1, 1, 3, 3]);
  const links = tokens.flatMap((token) => {
    const link = token.children?.find((child) => child.type === "link_open");
    return link
      ? [
          {
            href: link.attrGet("href")!,
            label: token.children?.find((child) => child.type === "text")
              ?.content,
          },
        ]
      : [];
  });
  assert.deepEqual(
    links.map(({ label }) => label),
    ["1 intro", "2.1 索引 [A] *原文* &copy;", "2.2 说明 [A] (B) #100%"],
  );

  mdk.reorderMdkEntries(file, [{ id: "later", position: "1.1" }]);
  assert.match(contents(file), /^ {2}- \[1\.1 /m);
  mdk.renameMdkEntry(file, "earlier", "改名 #1.md");
  const output = target("contents-delivery.mdk");
  mdk.exportMdk(file, output);
  assert.equal(contents(output), contents(file));
  const unpacked = target("contents-unpacked");
  mdk.unpackMdk(output, unpacked);
  const index = pathToFileURL(path.join(unpacked, CONTENTS_MARKDOWN_PATH));
  const targets = parser
    .parse(contents(output), {})
    .flatMap((token) =>
      (token.children ?? [])
        .filter((child) => child.type === "link_open")
        .map((child) => fileURLToPath(new URL(child.attrGet("href")!, index))),
    );
  assert.deepEqual(targets, [
    path.join(unpacked, "markdown", "intro.md"),
    path.join(unpacked, "markdown", "第一章", "改名 #1.md"),
    path.join(unpacked, "markdown", "第一章", "改名 #1.md"),
  ]);
  assert.equal(fs.readFileSync(targets[2], "utf8"), "# 正文\n");
  assert.equal(
    fileURLToPath(new URL(links[1].href, index)),
    path.join(unpacked, specialPath),
  );

  mdk.saveMdkTextFile(file, "settings.toml", "schema_version = 1\n");
  assert(
    !mdk
      .openMdkProject(file)
      .files.some(({ path }) => path === CONTENTS_MARKDOWN_PATH),
  );
});

test("enabling Markdown contents preserves a conflicting file or directory", () => {
  for (const name of [CONTENTS_MARKDOWN_PATH, "Contents.md/custom.txt"]) {
    const file = fixture(`contents-conflict-${name.includes("/")}.mdk`, "00", {
      "contents.toml": "schema_version = 1\n",
      [name]: "Keep this file.\n",
    });
    const project = mdk.openMdkProject(file);
    mdk.updateMdkSettings(file, project.settings);
    assert.equal(mdk.readMdkTextFile(file, name).content, "Keep this file.\n");
    const original = fs.readFileSync(file);
    project.settings.export.mdk.generate_contents_markdown = true;
    assert.throws(
      () => mdk.updateMdkSettings(file, project.settings),
      /contents\.md/,
    );
    assert.deepEqual(fs.readFileSync(file), original);
  }
});

test("archive rename preserves bytes and refuses existing names, stale revisions and directory traversal", () => {
  const file = target("rename-source.mdk");
  const occupied = target("rename-occupied.mdk");
  const renamed = mdk.mdkRenameTarget(file, "重命名工程.mdk");
  mdk.createMdkProject(file, "01");
  mdk.createMdkProject(occupied, "02");
  const original = fs.readFileSync(file);
  const other = fs.readFileSync(occupied);
  const revision = mdk.fileRevision(file);
  assert.equal(renamed, target("重命名工程.mdk"));
  for (const name of ["../unsafe", "sub/file", "CON", "extra."])
    assert.throws(() => mdk.mdkRenameTarget(file, name));
  assert.throws(
    () => mdk.renameMdkArchive(file, renamed, "stale"),
    mdk.MdkRevisionError,
  );
  assert.throws(() => mdk.renameMdkArchive(file, occupied, revision));
  assert.deepEqual(fs.readFileSync(occupied), other);
  assert.deepEqual(fs.readFileSync(file), original);
  mdk.renameMdkArchive(file, renamed, revision);
  assert(!fs.existsSync(file));
  assert.deepEqual(fs.readFileSync(renamed), original);
  const caseName = mdk.mdkRenameTarget(renamed, "renamed");
  const caseTarget = mdk.mdkRenameTarget(caseName, "Renamed");
  mdk.renameMdkArchive(renamed, caseName, revision);
  mdk.renameMdkArchive(caseName, caseTarget, revision);
  assert(fs.readdirSync(root).includes("Renamed.mdk"));
  assert.deepEqual(fs.readFileSync(caseTarget), original);
});

test("minimal v2 defaults to an editable empty project", () => {
  const file = fixture("minimal.mdk", "00", {
    "contents.toml": "schema_version = 1\n",
  });
  const project = mdk.openMdkProject(file);
  assert.equal(project.mode, "00");
  assert.deepEqual(project.contents.entries, []);
  assert.equal(project.settings.appearance.font_size, 16);
  assert.equal(mdk.validateMdk(file).valid, true);
  assert.equal(project.readonly, false);
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
      '[body]\nfont_size = 21\n[extension]\ncustom = "keep me"\n',
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
      '[[documents]]\nid = "manuscript"\npath = "markdown/正文.md"\n[[nodes]]\nid = "stable"\nkind = "document"\ndocument = "manuscript"\norder = 1\n\n',
    "markdown/正文.md": original,
    "custom/extension.bin": binary,
  });
  assert.equal(mdk.readMdkEntry(file, "stable").markdown, original);
  mdk.saveMdkEntry(file, "stable", original);
  mdk.exportMdk(file, target("preserve-export.mdk"));
  const zip = new AdmZip(fs.readFileSync(target("preserve-export.mdk")));
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
    { id, position: "2" },
    { id: second, position: "1" },
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
    "nodes = [2]",
    '[[nodes]]\nid=""\nkind="group"\norder=1',
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
    mdk
      .validateMdk(file)
      .issues.filter((i) => i.code === "com.mardikor.resource.unreferenced")
      .length,
    2,
  );
});

test("missing Markdown resources permit ordinary saves but block strict delivery", () => {
  const file = fixture("missing-resource.mdk", "01", {
    "contents.toml":
      '[[documents]]\nid="manuscript"\npath="markdown/001.md"\n[[nodes]]\nid="entry"\nkind="document"\ndocument="manuscript"\norder=1',
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
  const future = fixture("future.mdk", "00", {
    "mdk.toml": 'format_version=3\nproject_id="future"',
    "contents.toml": "",
  });
  assert.equal(mdk.openMdkProject(future).readonly, true);
  assert.equal(mdk.validateMdk(future).valid, false);
  const futureSettings = mdk.openMdkProject(
    fixture("future-settings.mdk", "00", {
      "contents.toml": "schema_version=1",
      "settings.toml": "[unclosed",
    }),
  );
  assert(futureSettings.settings_readonly);
});

test("malformed settings use temporary defaults without blocking base delivery", () => {
  const file = fixture("bad-settings.mdk", "00", {
    "contents.toml": "schema_version=1",
    "settings.toml": "[[broken",
  });
  assert.equal(mdk.openMdkProject(file).settings.appearance.font_size, 16);
  assert.equal(mdk.validateMdk(file).valid, true);
  assert.equal(mdk.validateMdk(file).issues[0].code, "mdk.settings.invalid");
});

test("base delivery preserves persistent data and omits rebuildable state", () => {
  const source = fixture("meta.mdk", "00", {
    "contents.toml": "",
    "meta/annotations.json": "{}",
    "state/com.example.cache/view": "state",
    "extension.txt": "keep",
  });
  const output = target("delivery.mdk");
  mdk.exportMdk(source, output);
  assert.equal(
    mdk.readMdkTextFile(output, "meta/annotations.json").content,
    "{}",
  );
  assert.equal(mdk.readMdkTextFile(output, "extension.txt").content, "keep");
  assert(
    !mdk
      .openMdkProject(output)
      .files.some(({ path }) => path.startsWith("state/")),
  );
});

test("pack/unpack roundtrip and existing output files are protected", () => {
  const file = target("pack-source.mdk");
  mdk.createMdkProject(file, "02");
  const directory = target("unpacked");
  mdk.unpackMdk(file, directory);
  assert.equal(
    parse(fs.readFileSync(path.join(directory, "mdk.toml"), "utf8")).mode,
    "comic",
  );
  const output = target("repacked.mdk");
  fs.mkdirSync(path.join(directory, "resources/empty"), { recursive: true });
  mdk.packMdk(directory, output);
  assert(
    mdk
      .openMdkProject(output)
      .files.some(
        (entry) =>
          entry.path === "resources/empty" && entry.kind === "directory",
      ),
  );
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

test("mode changes preserve authored settings and reject unknown modes", () => {
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
  assert.throws(() => mdk.setMdkMode(file, "aB"));
  mdk.setMdkMode(file, "comic");
  const loaded = mdk.openMdkProject(file);
  assert.equal(loaded.mode, "02");
  assert.equal(loaded.settings.mode.book.toc_depth, 5);
  assert.equal(loaded.settings.mode.comic.reading_direction, "rtl");
  assert.equal(loaded.settings.mode.comic.spread_mode, "double");
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

test("delivery preserves stable IDs and does not overwrite an existing output", () => {
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
  assert.throws(() => mdk.exportMdk(file, output));
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

test("resource management keeps nested paths, references and extraction inside resources", () => {
  const file = target("resource-manager.mdk");
  let project = mdk.createMdkProject(file, "00");
  project = mdk.createMdkResourceFolder(
    file,
    "resources",
    "Assets",
    project.revision,
  );
  project = mdk.createMdkResourceFolder(
    file,
    "resources/Assets",
    "Deep",
    project.revision,
  );
  const incoming = target("incoming-resources");
  fs.mkdirSync(path.join(incoming, "Empty"), { recursive: true });
  fs.writeFileSync(path.join(incoming, "notes.txt"), "original text");
  const second = target("notes.txt");
  fs.writeFileSync(second, "duplicate name");
  const dest = "resources/Assets/Deep";
  project = mdk.importMdkResourceBatch(
    file,
    dest,
    [incoming],
    project.revision,
  ).project;
  const importedFolder = dest + "/incoming-resources";
  project = mdk.importMdkResourceBatch(
    file,
    importedFolder,
    [second],
    project.revision,
  ).project;
  assert.ok(
    project.files.some(
      (entry) => entry.path === importedFolder + "/notes-2.txt",
    ),
  );
  const sourcePath = importedFolder + "/notes.txt";
  const manuscript = "markdown/001.md";
  const previousLink = "../" + sourcePath;
  mdk.saveMdkTextFile(
    file,
    manuscript,
    [
      "[Read][notes]",
      "",
      "[notes]: " + previousLink + '#part "Title"',
      "",
      "[Inline](" + previousLink + "?q=x#item)",
      "",
      "```md",
      "[Example](" + previousLink + ")",
      "```",
      "",
    ].join("\r\n"),
  );
  const contents = mdk.readMdkTextFile(file, "contents.toml").content;
  const before = mdk.fileRevision(file);
  assert.throws(() =>
    mdk.createMdkResourceFolder(file, "markdown", "hidden", before),
  );
  assert.throws(() =>
    mdk.createMdkResourceFolder(file, dest, "../hidden", before),
  );
  assert.throws(() =>
    mdk.renameMdkResource(file, "resources/other", "old", before),
  );
  assert.throws(() =>
    mdk.prepareMdkResourceExtraction(file, [manuscript], before),
  );
  assert.throws(() =>
    mdk.renameMdkResource(file, sourcePath, "notes-2.txt", before),
  );
  assert.equal(mdk.fileRevision(file), before);

  project = mdk.renameMdkResource(file, importedFolder, "Renamed", before);
  const renamed = dest + "/Renamed";
  const markdown = mdk.readMdkTextFile(file, manuscript).content;
  assert.ok(
    markdown.includes(`[notes]: <../${renamed}/notes.txt#part> "Title"`),
  );
  assert.ok(markdown.includes(`[Inline](<../${renamed}/notes.txt?q=x#item>)`));
  assert.ok(markdown.includes(`[Example](${previousLink})`));
  assert.ok(!/(?<!\r)\n/.test(markdown));
  assert.equal(mdk.readMdkTextFile(file, "contents.toml").content, contents);
  assert.ok(!project.issues.some(({ code }) => code === "E_RESOURCE_MISSING"));
  const single = mdk.prepareMdkResourceExtraction(
    file,
    [renamed + "/notes.txt"],
    project.revision,
  );
  assert.equal(single.filename, "notes.txt");
  const extracted = target("extracted-note.txt");
  assert.equal(single.extract(extracted).count, 1);
  assert.equal(fs.readFileSync(extracted, "utf8"), "original text");
  assert.throws(() => single.extract(extracted));
  assert.equal(fs.readFileSync(extracted, "utf8"), "original text");
  const batch = mdk.prepareMdkResourceExtraction(
    file,
    [dest, renamed + "/notes-2.txt"],
    project.revision,
  );
  assert.equal(batch.filename, undefined);
  const result = batch.extract(root);
  assert.equal(result.count, 2);
  assert.equal(
    fs.readFileSync(
      path.join(result.path, "Assets/Deep/Renamed/notes-2.txt"),
      "utf8",
    ),
    "duplicate name",
  );
  assert.ok(
    fs
      .statSync(path.join(result.path, "Assets/Deep/Renamed/Empty"))
      .isDirectory(),
  );
  assert.throws(() => mdk.importMdkResourceBatch(file, dest, [second], before));
});

test("a failing resource batch leaves every imported file outside the archive", () => {
  const file = target("resource-atomic.mdk");
  const project = mdk.createMdkProject(file, "00");
  const valid = target("valid-note.txt");
  const invalid = target("invalid-batch-image.png");
  fs.writeFileSync(valid, "keep external");
  fs.writeFileSync(invalid, "not a PNG");
  assert.throws(() =>
    mdk.importMdkResourceBatch(
      file,
      "resources/other",
      [valid, invalid],
      project.revision,
    ),
  );
  assert.equal(mdk.fileRevision(file), project.revision);
  assert.ok(
    !mdk
      .openMdkProject(file)
      .files.some(({ path }) => path.startsWith("resources/")),
  );
});

test("resource rename rewrites font and cover values while retaining TOML layout", () => {
  const file = target("resource-settings.mdk");
  let project = mdk.createMdkProject(file, "01");
  const font = target("custom.otf");
  const cover = target("resource-cover.png");
  fs.writeFileSync(font, Buffer.from("OTTO resource fixture"));
  fs.writeFileSync(cover, Buffer.from("89504e470d0a1a0a", "hex"));
  project = mdk.importMdkResourceBatch(
    file,
    "resources/font",
    [font],
    project.revision,
  ).project;
  mdk.importMdkResourceBatch(
    file,
    "resources/image",
    [cover],
    project.revision,
  );
  const settings = [
    "",
    "# Preserve this comment",
    "[body]",
    'font = "resources/font/custom.otf" # inline comment',
    "",
    "[extensions.unknown]",
    'data = "keep the original string"',
    "",
  ].join("\r\n");
  mdk.saveMdkTextFile(file, "settings.toml", settings);
  const manifest =
    mdk.readMdkTextFile(file, "mdk.toml").content +
    '\n[metadata]\ncover = "resources/image/resource-cover.png"\n';
  mdk.saveMdkTextFile(file, "mdk.toml", manifest);
  project = mdk.renameMdkResource(
    file,
    "resources/font/custom.otf",
    "renamed.otf",
    mdk.fileRevision(file),
  );
  project = mdk.renameMdkResource(
    file,
    "resources/image/resource-cover.png",
    "cover.png",
    project.revision,
  );
  assert.equal(
    mdk.readMdkTextFile(file, "settings.toml").content,
    settings.replace("custom.otf", "renamed.otf"),
  );
  assert.equal(
    mdk.readMdkTextFile(file, "mdk.toml").content,
    manifest.replace("resource-cover.png", "cover.png"),
  );
});
