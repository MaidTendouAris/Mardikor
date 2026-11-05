import assert from "node:assert/strict";
import { test, after } from "node:test";
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { parse } from "smol-toml";
import * as mdk from "../electron/mdk";
import { resolveReference } from "../shared/references";
import { parseToml, validateSourceText } from "../shared/schema";
import { renderPreview, settingsToCss } from "../src/services/preview";
import { defaultSettings } from "../shared/defaults";
import { AppState } from "../electron/state";

const root = fs.mkdtempSync(path.resolve(".test-artifacts/revision-"));
after(() => {
  assert(root.startsWith(path.resolve(".test-artifacts") + path.sep));
  fs.rmSync(root, { recursive: true, force: true });
});
const target = (name: string) => path.join(root, name);
function fixture(
  name: string,
  files: Record<string, string | Buffer>,
  mode = "00",
) {
  const zip = new AdmZip(undefined, { noSort: true });
  zip.addFile("mimetype", Buffer.from(mdk.MDK_MIMETYPE));
  zip.getEntry("mimetype")!.header.method = 0;
  zip.addFile("contents.toml", Buffer.from("schema_version=1\n"));
  for (const [name, data] of Object.entries(files))
    zip.addFile(name, Buffer.from(data));
  const file = target(name);
  fs.writeFileSync(file, Buffer.concat([Buffer.from(mode), zip.toBuffer()]));
  return file;
}
const controls =
  'schema_version=1\n[[entries]]\nid="a"\npath="markdown/a.md"\nposition="2.1"\n[[entries]]\nid="b"\npath="markdown/a.md"\nposition="3"\n';

test("revised defaults are exact and legal numbers outside UI suggestions remain legal", () => {
  const file = fixture("defaults.mdk", {
    "settings.toml":
      "schema_version=1\n[appearance]\nfont_size=160\n[layout]\npage_width=100\nmargin_left=10\nmargin_right=10\n",
  });
  const project = mdk.openMdkProject(file);
  assert.equal(project.settings.appearance.font_size, 160);
  assert.equal(project.settings.layout.page_width, 100);
  assert.equal(project.settings.appearance.line_height, 1.7);
  assert.equal(project.settings.appearance.paragraph_spacing, 0.8);
  assert.equal(project.settings.colors.text, "#1f2933");
  assert.equal(project.settings.export.include_meta, true);
  assert.equal(project.settings.export.include_editor_state, false);
  assert(mdk.validateMdk(file).valid);
  const settings = defaultSettings();
  settings.appearance.theme = "serif";
  assert.equal(
    settingsToCss(settings)["--preview-font-family"],
    settingsToCss(defaultSettings())["--preview-font-family"],
  );
});
test("invalid settings fall back by leaf, table and geometry group without modifying original bytes", () => {
  const source =
    'schema_version=1\n[appearance]\nfont_size=-1\n[colors]\ntext="#123456"\n[layout]\npage_width=50\nmargin_left=30\nmargin_right=30\nmargin_top=8\n';
  const file = fixture("fallback.mdk", {
    "settings.toml": source,
    "markdown/a.md": "# before",
  });
  const project = mdk.openMdkProject(file);
  assert.equal(project.settings.appearance.font_size, 16);
  assert.equal(project.settings.colors.text, "#123456");
  assert.deepEqual(
    [
      project.settings.layout.page_width,
      project.settings.layout.margin_left,
      project.settings.layout.margin_right,
    ],
    [720, 32, 32],
  );
  assert.equal(project.settings.layout.margin_top, 8);
  mdk.saveMdkTextFile(file, "markdown/a.md", "# after");
  assert.equal(mdk.readMdkTextFile(file, "settings.toml").content, source);
  assert(!mdk.validateMdk(file).valid);
  const wrongTable = fixture("table.mdk", {
    "settings.toml":
      'schema_version=1\nappearance="bad"\n[layout]\npage_width=400\n',
  });
  assert.equal(mdk.openMdkProject(wrongTable).settings.layout.page_width, 400);
});
test("BOM controls and future settings open losslessly while float schema and integer-only floats are rejected", () => {
  const file = fixture("bom.mdk", {
    "contents.toml": "\ufeffschema_version=1\r\n",
    "settings.toml": '\ufeffschema_version=2\r\n[future]\nvalue="keep"\r\n',
    "markdown/a.md": "text",
  });
  assert(mdk.openMdkProject(file).settings_readonly);
  const before = mdk.readMdkTextFile(file, "settings.toml").content;
  mdk.saveMdkTextFile(file, "markdown/a.md", "changed");
  assert.equal(mdk.readMdkTextFile(file, "settings.toml").content, before);
  assert.throws(() => mdk.updateMdkSettings(file, defaultSettings()));
  assert(!mdk.validateMdk(file).valid);
  for (const value of ["1.0", '"1"', "0", "-1"])
    assert.throws(() =>
      validateSourceText("contents.toml", "schema_version=" + value),
    );
  assert.throws(() =>
    validateSourceText(
      "settings.toml",
      "schema_version=1\n[mode.book]\ntoc_depth=3.0",
    ),
  );
});
test("missing manuscripts, resources, unsafe URLs and external display dependencies allow saves but prevent portable delivery", () => {
  const file = fixture("incomplete.mdk", { "contents.toml": controls });
  assert.equal(mdk.openMdkProject(file).contents.entries.length, 2);
  assert(
    mdk.openMdkProject(file).issues.some((i) => i.code === "E_CONTENT_MISSING"),
  );
  mdk.saveMdkTextFile(file, "meta/note.txt", "work in progress");
  assert.throws(() => mdk.exportMdk(file, target("incomplete-export.mdk")));
  mdk.createTextFile(
    file,
    "markdown/a.md",
    "![missing](../resources/image/missing.png)\n[unsafe](../../outside.txt)\n![external](https://example.com/a.png)",
  );
  assert.equal(mdk.openMdkProject(file).contents.entries.length, 2);
  const report = mdk.validateMdk(file);
  for (const code of [
    "E_RESOURCE_MISSING",
    "E_REFERENCE_UNSAFE",
    "E_EXTERNAL_MEDIA",
  ])
    assert(report.issues.some((i) => i.code === code));
  mdk.saveMdkTextFile(
    file,
    "markdown/a.md",
    "[external navigation](https://example.com/)\n",
  );
  assert(mdk.validateMdk(file).valid);
});
test("reference resolution decodes each segment exactly once and distinguishes URL paths from archive names", () => {
  for (const url of [
    "../../x",
    "%2e%2e/%2e%2e/x",
    "../resources/a%2fb.png",
    "../resources/a%5cb",
    "../resources/%GG",
    "/root",
    "a//b",
    "data:image/png;base64,abc",
    "file:///x",
    "javascript:alert(1)",
  ])
    assert.equal(
      resolveReference("markdown/a.md", url, true).kind,
      "unsafe",
      url,
    );
  assert.deepEqual(
    resolveReference(
      "markdown/nested/a.md",
      "../../resources/image/a%23b%3fc%25.png?q#h",
    ),
    { kind: "local", path: "resources/image/a#b?c%.png", suffix: "?q#h" },
  );
  assert.deepEqual(
    resolveReference("markdown/a.md", "../resources/%252e%252e.txt"),
    { kind: "local", path: "resources/%2e%2e.txt", suffix: "" },
  );
  assert.deepEqual(resolveReference("markdown/a.md", "#part"), {
    kind: "local",
    path: "markdown/a.md",
    suffix: "#part",
  });
  assert.equal(
    resolveReference("markdown/a.md", "mailto:user@example.com").kind,
    "external",
  );
});
test("default delivery retains persistent/unknown meta and removes only fully recognized reconstructible state", () => {
  const file = fixture("meta-safe.mdk", {
    "meta/annotations.json": '{"comments":[1]}',
    "meta/unknown.json": '{"x":1}',
    "meta/editor-state.json":
      '{"schema_version":1,"cursor":{"line":1,"column":2}}',
  });
  let plan = mdk.planMdkExport(file);
  assert.deepEqual(plan.excluded_meta, ["meta/editor-state.json"]);
  assert.equal(plan.confirmation_required, false);
  mdk.exportMdk(file, target("meta-safe-export.mdk"));
  assert.equal(
    mdk.readMdkTextFile(target("meta-safe-export.mdk"), "meta/annotations.json")
      .content,
    '{"comments":[1]}',
  );
  mdk.saveMdkTextFile(
    file,
    "meta/editor-state.json",
    '{"schema_version":1,"cursor":{"line":1,"annotation":"persistent"}}',
  );
  plan = mdk.planMdkExport(file);
  assert(plan.included_meta.includes("meta/editor-state.json"));
  const settings = mdk.openMdkProject(file).settings;
  settings.export.include_meta = false;
  mdk.updateMdkSettings(file, settings);
  plan = mdk.planMdkExport(file);
  assert(plan.confirmation_required);
  assert.throws(() => mdk.exportMdk(file, target("meta-stripped.mdk")));
  mdk.exportMdk(file, target("meta-stripped.mdk"), plan.revision);
  assert(
    !mdk
      .openMdkProject(target("meta-stripped.mdk"))
      .files.some((f) => f.path.startsWith("meta/")),
  );
  assert(
    mdk
      .openMdkProject(file)
      .files.some((f) => f.path === "meta/annotations.json"),
  );
});
test("delivery rechecks references after meta filtering and refuses stale confirmation", () => {
  const file = fixture("meta-link.mdk", {
    "markdown/a.md": "[annotations](../meta/annotations.json)",
    "meta/annotations.json": "{}",
  });
  let settings = mdk.openMdkProject(file).settings;
  settings.export.include_meta = false;
  mdk.updateMdkSettings(file, settings);
  assert(!mdk.planMdkExport(file).report.valid);
  mdk.saveMdkTextFile(file, "markdown/a.md", "text");
  const plan = mdk.planMdkExport(file);
  mdk.saveMdkTextFile(file, "meta/annotations.json", '{"new":true}');
  assert.throws(() =>
    mdk.exportMdk(file, target("stale-confirm.mdk"), plan.revision),
  );
});
test("atomic snapshot detects concurrent source changes and never commits a partial new directory", () => {
  const file = mdk.createMdkProject(target("snapshot.mdk"), "01");
  const pathName = target("snapshot.mdk"),
    id = file.contents.entries[0].id;
  const before = fs.readFileSync(pathName);
  assert.throws(() =>
    mdk.saveMdkSnapshot(pathName, {
      revision: file.revision,
      text: { path: "markdown/001.md", content: "new" },
      positions: [{ id, position: "0" }],
    }),
  );
  assert.deepEqual(fs.readFileSync(pathName), before);
  const saved = mdk.saveMdkSnapshot(pathName, {
    revision: file.revision,
    text: { path: "markdown/001.md", content: "new" },
    positions: [{ id, position: "2.1" }],
  });
  assert.equal(saved.contents.entries[0].position, "2.1");
  assert.equal(mdk.readMdkEntry(pathName, id).markdown, "new");
  assert.throws(() =>
    mdk.saveMdkSnapshot(pathName, {
      revision: file.revision,
      text: { path: "markdown/001.md", content: "stale" },
    }),
  );
  assert.equal(mdk.readMdkEntry(pathName, id).markdown, "new");
});
test("unknown entry fields follow stable IDs and unknown integer/float field types survive structured edits", () => {
  const file = fixture("extensions.mdk", {
    "contents.toml": controls.replace(
      'id="a"',
      'id="a"\nextension_integer=9223372036854775807\nextension_float=1.0',
    ),
    "markdown/a.md": "# shared",
  });
  mdk.reorderMdkEntries(file, [
    { id: "a", position: "4" },
    { id: "b", position: "1" },
  ]);
  const value = parse(mdk.readMdkTextFile(file, "contents.toml").content, {
    integersAsBigInt: true,
  }).entries as Record<string, unknown>[];
  assert.equal(
    value.find((e) => e.id === "a")?.extension_integer,
    9223372036854775807n,
  );
  assert.equal(
    typeof value.find((e) => e.id === "a")?.extension_float,
    "number",
  );
  mdk.deleteMdkEntry(file, "a");
  assert.equal(mdk.readMdkEntry(file, "b").markdown, "# shared");
});
test("book and comic read actual entries in numeric order, including duplicate paths and virtual parents", () => {
  const file = fixture(
    "comic.mdk",
    {
      "contents.toml": controls,
      "markdown/a.md":
        "# 混排\n\n普通正文\n\n![一](../resources/image/a.png)\n\n![二](../resources/image/b.png)",
    },
    "02",
  );
  const units = mdk.readMdkReadingUnits(file);
  assert.deepEqual(
    units.map((u) => u.id),
    ["a", "b"],
  );
  assert(units.every((u) => u.markdown?.includes("普通正文")));
  const before = mdk.readMdkTextFile(file, "markdown/a.md").content;
  mdk.setMdkMode(file, "00");
  assert.equal(mdk.readMdkTextFile(file, "markdown/a.md").content, before);
});
test("strict containers preserve unknown/unclosed syntax and code fences; raw HTML and media never auto-load", () => {
  const settings = defaultSettings();
  for (const source of [
    ":::note title\ntext\n:::",
    ":::unknown\ntext\n:::",
    ":::note\ntext",
  ])
    assert.doesNotMatch(renderPreview(source, settings), /<aside/);
  const html = renderPreview(
    "::::note\n:::tip\ninside\n:::\n```\n::::\n```\noutside\n::::",
    settings,
  );
  assert.match(html, /<aside class="mdk-note">/);
  assert.match(html, /<aside class="mdk-tip">/);
  assert.match(html, /<code>::::/);
  assert.match(html, /outside/);
  const safe = renderPreview(
    "<script>alert(1)</script>\n\n![external](https://example.com/image.png)\n\n|a|b|\n|-|-|\n|1|2|",
    settings,
  );
  assert.doesNotMatch(safe, /<script|src="https:/);
  assert.match(safe, /data-mdk-ref=/);
  assert.match(safe, /<table>/);
});
test("physical mimetype first is accepted independently of central directory order; unsupported methods and conflicts are rejected", () => {
  const file = fixture("central-order.mdk", { "extra.txt": "abc" });
  const data = fs.readFileSync(file),
    payload = data.subarray(2),
    end = payload.length - 22,
    start = payload.readUInt32LE(end + 16);
  let cursor = start;
  const records: Buffer[] = [];
  while (cursor < end) {
    const length =
      46 +
      payload.readUInt16LE(cursor + 28) +
      payload.readUInt16LE(cursor + 30) +
      payload.readUInt16LE(cursor + 32);
    records.push(Buffer.from(payload.subarray(cursor, cursor + length)));
    cursor += length;
  }
  Buffer.concat(records.reverse()).copy(payload, start);
  fs.writeFileSync(file, data);
  assert(mdk.validateMdk(file).valid);
  const conflict = fixture("conflict.mdk", {
    same: "file",
    "same/child.txt": "child",
  });
  assert.throws(() => mdk.openMdkProject(conflict));
  const method = fixture("method.mdk", { "extra.txt": "abc" });
  const bytes = fs.readFileSync(method),
    cd = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes.writeUInt16LE(12, cd + 10);
  fs.writeFileSync(method, bytes);
  assert.throws(() => mdk.openMdkProject(method));
});
test("recovery drafts retain invalid controls and bigint extension fields without touching the MDK", () => {
  const state = new AppState(target("recovery")),
    file = fixture("recovery.mdk", {}),
    before = fs.readFileSync(file);
  const draft = {
    revision: mdk.fileRevision(file),
    text: { path: "contents.toml", content: "invalid [" },
    settings: parseToml(
      "schema_version=1\n[extension]\nlarge=9223372036854775807",
    ) as never,
  };
  state.recovery(file, draft);
  const recovered = new AppState(target("recovery")).recovery(file)!;
  assert.equal(recovered.revision, draft.revision);
  assert.deepEqual(recovered.text, draft.text);
  assert.equal(
    (recovered.settings as unknown as Record<string, Record<string, unknown>>)
      .extension.large,
    9223372036854775807n,
  );
  assert.deepEqual(fs.readFileSync(file), before);
  state.recovery(file, null);
  assert.equal(state.recovery(file), null);
});

test("data descriptors are supported for ordinary entries and all file CRCs are checked on open", () => {
  const file = fixture("descriptor.mdk", {}),
    bytes = fs.readFileSync(file),
    payload = bytes.subarray(2),
    end = payload.length - 22,
    start = payload.readUInt32LE(end + 16);
  const firstLength =
      46 +
      payload.readUInt16LE(start + 28) +
      payload.readUInt16LE(start + 30) +
      payload.readUInt16LE(start + 32),
    central = start + firstLength,
    offset = payload.readUInt32LE(central + 42);
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  for (let i = 0; i < 3; i++)
    descriptor.writeUInt32LE(
      payload.readUInt32LE(central + 16 + i * 4),
      4 + i * 4,
    );
  const changed = Buffer.concat([
    payload.subarray(0, start),
    descriptor,
    payload.subarray(start),
  ]);
  changed.writeUInt32LE(start + 16, end + 16 + 16);
  changed.writeUInt16LE(
    changed.readUInt16LE(central + 16 + 8) | 8,
    central + 16 + 8,
  );
  changed.writeUInt16LE(changed.readUInt16LE(offset + 6) | 8, offset + 6);
  for (const field of [14, 18, 22]) changed.writeUInt32LE(0, offset + field);
  fs.writeFileSync(file, Buffer.concat([Buffer.from("00"), changed]));
  assert(mdk.validateMdk(file).valid);
  const crc = fixture("bad-crc.mdk", { "extra.txt": "CRC-body" }),
    zip = new AdmZip(undefined, { noSort: true });
  for (const entry of new AdmZip(fs.readFileSync(crc).subarray(2)).getEntries())
    zip.addFile(entry.entryName, entry.getData());
  zip.getEntry("mimetype")!.header.method = 0;
  zip.getEntry("extra.txt")!.header.method = 0;
  let corrupt = Buffer.concat([Buffer.from("00"), zip.toBuffer()]);
  const body = corrupt.indexOf(Buffer.from("CRC-body"));
  assert(body >= 0);
  corrupt[body] ^= 1;
  fs.writeFileSync(crc, corrupt);
  assert.throws(() => mdk.openMdkProject(crc));
  const nested = renderPreview(
    "[file](../../resources/a.txt)",
    defaultSettings(),
    "",
    "00",
    "",
    "markdown/sub/doc.md",
  );
  assert.match(nested, /data-mdk-link=/);
});
