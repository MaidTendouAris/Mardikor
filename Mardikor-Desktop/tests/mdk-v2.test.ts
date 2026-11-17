import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { crc32, deflateRawSync } from "node:zlib";
import AdmZip from "adm-zip";
import { parse } from "smol-toml";
import * as mdk from "../electron/mdk";
import { addArchiveMember } from "../electron/archive";
import { preparePublication } from "../electron/publication";
import { buildEpub } from "../electron/epub";
import { publicationHtml } from "../electron/publication-render";
import { markdownHeadings } from "../shared/markdown";
import { inspectV2Settings } from "../shared/settings-v2";
import { parseToml } from "../shared/schema";
import { settingsFields } from "../shared/settings-v2-fields";
import { renderPreview } from "../src/services/preview";

fs.mkdirSync(".test-artifacts", { recursive: true });
const root = fs.mkdtempSync(path.resolve(".test-artifacts/v2-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const at = (name: string) => path.join(root, name);
const header = 'format_version = 2\nproject_id = "example-1"\n';
function fixture(
  filename: string,
  entries: Record<string, string | Buffer> = {},
  control = header,
) {
  const zip = new AdmZip(undefined, { noSort: true });
  const fields = {
    mimetype: mdk.MDK_MIMETYPE,
    "mdk.toml": control,
    "contents.toml": "",
    ...entries,
  };
  for (const [name, data] of Object.entries(fields))
    addArchiveMember(zip, name, Buffer.from(data));
  const file = at(filename);
  fs.writeFileSync(file, zip.toBuffer());
  return file;
}

test("v2 writer, reader and independent ZIP parser agree about file offsets, contents and flags", () => {
  const file = at("created.mdk");
  const project = mdk.createMdkProject(file, "book");
  const raw = fs.readFileSync(file);
  assert.equal(raw.readUInt32LE(0), 0x04034b50);
  const zip = new AdmZip(raw);
  const [mime, manifest] = zip.getEntries();
  assert.deepEqual(
    [mime.entryName, manifest.entryName],
    ["mimetype", "mdk.toml"],
  );
  assert.equal(zip.readAsText(mime), mdk.MDK_MIMETYPE);
  assert.equal(mime.header.method, 0);
  assert.equal(manifest.header.method, 0);
  assert.equal(mime.header.flags & 0x808, 0x800);
  assert.equal(manifest.header.flags & 0x808, 0x800);
  const control = parse(zip.readAsText("mdk.toml"));
  assert.equal(control.format_version, 2);
  assert.equal(control.mode, "book");
  assert.equal(control.project_id, project.projectId);
  const contents = parse(zip.readAsText("contents.toml"));
  assert.equal(contents.schema_version, undefined);
  assert.equal(
    project.contents.nodes?.[0].document,
    project.contents.documents?.[0].id,
  );
});

test("unrecognized bytes, invalid recognized ZIP and invalid core fields have distinct results", () => {
  const exact = fixture("valid.mdk"),
    bytes = fs.readFileSync(exact);
  const prefix = at("prefix.mdk");
  fs.writeFileSync(prefix, Buffer.concat([Buffer.from("00"), bytes]));
  const prefixed = mdk.validateMdk(prefix);
  assert.equal(prefixed.scopes?.[0].status, "unverified");
  assert.equal(prefixed.issues[0].code, "mdk.container.unrecognized");
  assert.equal(prefixed.issues[0].severity, "error");
  const corrupt = at("corrupt.mdk");
  fs.writeFileSync(corrupt, bytes.subarray(0, bytes.length - 22));
  assert.equal(mdk.validateMdk(corrupt).scopes?.[0].status, "fail");
  const floating = fixture("floating.mdk", {}, header.replace("= 2", "= 2.0"));
  assert.equal(mdk.validateMdk(floating).issues[0].field, "format_version");
  const bom = fixture("bom.mdk", {}, "\ufeff" + header);
  assert.equal(mdk.validateMdk(bom).issues[0].scope, "core");
  const uri = fixture(
    "uri.mdk",
    {},
    header + '[metadata]\nidentifier = "urn:test#illegal"\n',
  );
  assert.equal(mdk.validateMdk(uri).issues[0].field, "metadata.identifier");
  for (const [i, identifier] of [
    "../book",
    "C:/book",
    "scheme:book%XY",
    "scheme:book[part]",
    "scheme://[not-an-ip]/a",
    "scheme://u@host:abc",
    "scheme:space here",
  ].entries()) {
    const invalid = fixture(
      `uri-${i}.mdk`,
      {},
      header + "[metadata]\nidentifier=" + JSON.stringify(identifier),
    );
    assert.equal(
      mdk.validateMdk(invalid).issues[0].field,
      "metadata.identifier",
      identifier,
    );
  }
  const validUri = fixture(
    "uri-valid.mdk",
    {},
    header +
      '[metadata]\nidentifier="scheme://[2001:db8::1]:80/a%20b?q=1"\nlanguage="i-klingon"',
  );
  assert.equal(mdk.validateMdk(validUri).valid, true);
  const invalidTag = fixture(
    "language.mdk",
    {},
    header + '[metadata]\nlanguage="en-u-ca-a178-u-nu-latn"',
  );
  assert.equal(
    mdk.validateMdk(invalidTag).issues[0].field,
    "metadata.language",
  );
});

test("the finalized book example opens with groups, repeat occurrences and distinct identities", () => {
  const file = at("book.mdk");
  mdk.packMdk("docs/examples/v2/book", file);
  const project = mdk.openMdkProject(file);
  assert.equal(project.contents.documents?.length, 3);
  assert.equal(
    project.contents.entries.filter((entry) => entry.kind === "group").length,
    1,
  );
  const units = mdk.readMdkReadingUnits(file);
  assert.deepEqual(
    units.map(({ id }) => id),
    ["node-intro", "node-road", "node-home", "node-intro-again"],
  );
  assert.equal(units[0].documentId, units.at(-1)?.documentId);
  assert.notEqual(units[0].id, units.at(-1)?.id);
  assert.equal(mdk.validateMdk(file).valid, true);
});

test("drafts, empty groups and repeated manuscripts retain identity after reordering and deletion", () => {
  const original = fixture("edits.mdk", {
    "contents.toml": `
[[documents]]
id = "body"
path = "markdown/a.md"
extensions = { "org.example.note" = { counter = 9223372036854775807 } }

[[nodes]]
id = "group"
kind = "group"
title = "分组"
order = 20

[[nodes]]
id = "chapter"
parent = "group"
kind = "document"
document = "body"
order = 30

[[nodes]]
id = "again"
kind = "document"
document = "body"
order = 40
`,
    "markdown/a.md": "\ufeff# A\r\n\r\nOriginal.\r\n",
    "markdown/draft.md": "# Draft",
    "meta/extra.dat": Buffer.from([0, 241, 251]),
  });
  const added = mdk.addMdkGroup(original, "空组", "group");
  const child = added.contents.entries.find((entry) => entry.title === "空组")!;
  assert.equal(child.parent, "group");
  mdk.reorderMdkEntries(original, [{ id: "again", position: "1.3" }]);
  const moved = mdk.openMdkProject(original);
  assert.equal(
    moved.contents.nodes?.find((node) => node.id === "again")?.parent,
    "group",
  );
  mdk.deleteMdkEntry(original, "chapter");
  assert.equal(
    mdk.readMdkEntry(original, "body").markdown,
    "\ufeff# A\r\n\r\nOriginal.\r\n",
  );
  const contents = mdk.readMdkTextFile(original, "contents.toml").content;
  assert.match(contents, /9223372036854775807/);
  const archive = new AdmZip(fs.readFileSync(original));
  assert.deepEqual(
    archive.readFile("meta/extra.dat"),
    Buffer.from([0, 241, 251]),
  );
  assert.equal(archive.readAsText("markdown/draft.md"), "# Draft");
});

test("missing parent, duplicate sibling order, cycles and integer floats cannot be saved", () => {
  const file = fixture("invalid-edit.mdk");
  const state = fs.readFileSync(file);
  const node = (id: string, order: string, parent?: string) =>
    `[[nodes]]\nid="${id}"\nkind="group"\ntitle="${id}"\norder=${order}\n${parent ? `parent="${parent}"\n` : ""}`;
  for (const source of [
    node("a", "1.0"),
    node("a", "1", "ghost"),
    node("a", "1", "b") + node("b", "1", "a"),
    node("a", "1") + node("b", "1"),
  ]) {
    assert.throws(() => mdk.saveMdkTextFile(file, "contents.toml", source));
    assert.deepEqual(fs.readFileSync(file), state);
  }
});

test("optional dependencies do not forbid safe saves; required capability blocks writes", () => {
  const optional = fixture(
    "optional.mdk",
    {
      "meta/org.example.notes/note.json": '{"kept":true}',
      "state/org.example.viewer/cache": "discardable",
    },
    header + '\n[features]\noptional = ["org.example.notes@1"]\n',
  );
  mdk.createTextFile(optional, "markdown/draft.md", "# Draft");
  const output = at("optional-delivery.mdk");
  mdk.exportMdk(optional, output);
  const delivered = new AdmZip(fs.readFileSync(output));
  assert.equal(
    delivered.readAsText("meta/org.example.notes/note.json"),
    '{"kept":true}',
  );
  assert.equal(delivered.getEntry("state/org.example.viewer/cache"), null);
  const selection = {
    includeState: true,
    exclude: ["meta/org.example.notes/note.json"],
  };
  const plan = mdk.planMdkExport(optional, selection);
  assert.deepEqual(plan.excluded_persistent, selection.exclude);
  const selected = at("selected-delivery.mdk");
  assert.throws(() => mdk.exportMdk(optional, selected, "", selection));
  mdk.exportMdk(optional, selected, plan.revision, selection);
  const filtered = new AdmZip(fs.readFileSync(selected));
  assert.equal(filtered.getEntry(selection.exclude[0]), null);
  assert.equal(
    filtered.readAsText("state/org.example.viewer/cache"),
    "discardable",
  );
  assert.ok(
    new AdmZip(fs.readFileSync(optional)).getEntry(selection.exclude[0]),
  );
  const required = fixture(
    "required.mdk",
    {},
    header + '\n[features]\nrequired = ["org.example.notes@1"]\n',
  );
  assert.equal(mdk.openMdkProject(required).readonly, true);
  assert.equal(
    mdk.validateMdk(required).scopes?.find(({ scope }) => scope === "core")
      ?.status,
    "unverified",
  );
  assert.throws(() => mdk.setMdkMode(required, "book"));
});

test("settings validate their field catalogue, report coupled errors and preserve unrelated data on repair", () => {
  const settings =
    '[body]\nfont_size = 21\n[preview]\nmax_width = 40\n[toc]\nheading_min_level = 5\nheading_max_level = 2\n[extensions."org.example.data"]\ncount = 9223372036854775807\n';
  const file = fixture("settings.mdk", { "settings.toml": settings });
  const project = mdk.openMdkProject(file);
  assert.equal(project.settings.appearance.font_size, 21);
  assert.equal(project.settings.layout.page_width, 720);
  assert.match(
    project.issues.map(({ field }) => field).join(","),
    /preview\.geometry.*toc\.heading_range/,
  );
  assert.equal(mdk.validateMdk(file).valid, true);
  project.settings.appearance.font_size = 23;
  mdk.updateMdkSettings(file, project.settings);
  const after = mdk.readMdkTextFile(file, "settings.toml").content;
  assert.match(after, /font_size = 23/);
  assert.match(after, /9223372036854775807/);
  assert.equal(mdk.openMdkProject(file).settings.layout.page_width, 720);
  mdk.saveMdkTextFile(
    file,
    "settings.toml",
    after.replace("font_size = 23", "font_size = 24"),
  );
  assert.throws(() =>
    mdk.saveMdkTextFile(
      file,
      "settings.toml",
      after.replace("heading_min_level = 5", "heading_min_level = 6"),
    ),
  );
  assert.equal(Object.keys(settingsFields).length, 179);
  assert.equal(
    inspectV2Settings(
      parseToml(fs.readFileSync("docs/examples/v2/settings.full.toml", "utf8")),
      "01",
    ).problems.length,
    0,
  );
});

test("v2 headings and rendered Markdown use a consistent literal HTML and anchor profile", () => {
  const source =
    "# 章 **One**\n# 章 One\n# 章 One-2\n\n> # ~~Nested~~\n\n<div>\n# not a heading\n</div>\n\n$no_math$\n";
  assert.deepEqual(
    markdownHeadings(source, true).map(({ anchor }) => anchor),
    ["h-章-one", "h-章-one-2", "h-章-one-2-2", "h-nested"],
  );
  const settings = inspectV2Settings(
    parseToml("[body]\nfont_size=20\n[headings.h1]\nsize_scale=2.5\n"),
    "00",
  ).settings;
  const html = renderPreview(source, settings);
  assert.match(html, /data-fragment="h-章-one-2-2"/);
  assert.match(html, /&lt;div&gt;/);
  assert.match(html, /\$no_math\$/);
  assert.match(html, /font-size:50px/);
  assert.equal(markdownHeadings("\uFEFF# First", true)[0]?.anchor, "h-first");
  assert.deepEqual(markdownHeadings("\uFEFF\uFEFF# Still a paragraph", true), []);
  assert.deepEqual(
    markdownHeadings("# E\u0301 \u{1c89} 㐀", true).map(({ anchor }) => anchor),
    ["h-É-㐀"],
  );
});

test("a bad sibling preset and required extension do not stop a valid target", () => {
  const file = fixture(
    "preset-selection.mdk",
    {
      "contents.toml":
        '[[documents]]\nid="manuscript"\npath="markdown/body.md"\n[[nodes]]\nid="main"\nkind="document"\ndocument="manuscript"\norder=1\n',
      "markdown/body.md": "# Body",
      "publication.toml":
        '[[presets]]\nid="bad"\nformat="pdf"\n[presets.pdf]\nlayout="bad"\n[[presets]]\nid="requires"\nformat="epub"\nrequires=["org.example.reader@1"]\n[presets.epub]\nlayout="reflowable"\n[[presets]]\nid="reading"\nformat="epub"\n[presets.epub]\nlayout="reflowable"\n',
    },
    header +
      '[metadata]\ntitle="Book"\nlanguage="en"\nidentifier="urn:example:book"',
  );
  const runtime = {
    engine: "test",
    assetDirectory: path.resolve("assets/export"),
    localConfiguration: () => null,
    verifyImages() {},
  };
  assert.equal(mdk.validateMdk(file).valid, true);
  assert.equal(
    mdk.validateMdk(file).scopes?.find(({ scope }) => scope === "publication")
      ?.status,
    "fail",
  );
  assert.deepEqual(
    preparePublication(file, "epub", runtime, "reading").issues.filter(
      ({ severity }) => severity === "error",
    ),
    [],
  );
  assert(
    preparePublication(file, "epub", runtime, "requires").issues.some(
      ({ status }) => status === "unverified",
    ),
  );
  assert(
    preparePublication(file, "pdf", runtime, "bad").issues.some(
      ({ status }) => status === "fail",
    ),
  );
});

test("a physically reordered second control is invalid independently of central order", () => {
  const zip = new AdmZip(undefined, { noSort: true });
  addArchiveMember(zip, "mimetype", Buffer.from(mdk.MDK_MIMETYPE));
  addArchiveMember(zip, "contents.toml", Buffer.alloc(0));
  addArchiveMember(zip, "mdk.toml", Buffer.from(header));
  const file = at("physical-order.mdk");
  fs.writeFileSync(file, zip.toBuffer());
  const result = mdk.validateMdk(file);
  assert.equal(
    result.scopes?.find(({ scope }) => scope === "container")?.status,
    "fail",
  );
});

test("empty content, unknown outline fields, depth limits and portability remain distinct", () => {
  const empty = fixture("outline-extensions.mdk", {
    "contents.toml":
      'opaque = "persist"\n[extensions."org.example.structure"]\nflag = true\n',
    "meta/CON.txt": "Valid internal file",
  });
  const before = mdk.readMdkTextFile(empty, "contents.toml").content;
  mdk.saveMdkTextFile(empty, "markdown/draft.md", "# Draft");
  assert.equal(mdk.openMdkProject(empty).contents.nodes?.length, 0);
  assert.equal(mdk.readMdkTextFile(empty, "contents.toml").content, before);
  assert.equal(mdk.validateMdk(empty).valid, true);
  assert(
    mdk
      .validateMdk(empty)
      .issues.some(({ code }) => code === "mdk.path.nonportable"),
  );
  assert.throws(() => mdk.unpackMdk(empty, at("unpack-unsupported")));

  const repeatedPath = fixture("repeated-registry-path.mdk", {
    "contents.toml":
      '[[documents]]\nid="one"\npath="markdown/shared.md"\n[[documents]]\nid="two"\npath="markdown/shared.md"\n',
  });
  assert.equal(
    mdk.validateMdk(repeatedPath).scopes?.find(({ scope }) => scope === "core")
      ?.status,
    "fail",
  );
  const deepNodes = Array.from(
    { length: 129 },
    (_, i) =>
      `[[nodes]]\nid="node-${i}"\nkind="group"\ntitle="Group"\norder=1\n` +
      (i ? `parent="node-${i - 1}"\n` : ""),
  );
  const deepFile = fixture("depth-limit.mdk", {
    "contents.toml": deepNodes.join(""),
  });
  const report = mdk.validateMdk(deepFile);
  assert.equal(
    report.scopes?.find(({ scope }) => scope === "core")?.status,
    "unverified",
  );
  assert.equal(report.issues[0].code, "mdk.limit.exceeded");
});

test("PDF cover and contents are independent of mode and use only the selected preset", () => {
  const file = at("pdf-cover.mdk");
  mdk.packMdk("docs/examples/v2/book", file);
  const runtime = {
    engine: "test",
    assetDirectory: path.resolve("assets/export"),
    localConfiguration: () => null,
    verifyImages() {},
  };
  for (const [cover, toc] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ]) {
    mdk.saveMdkTextFile(
      file,
      "publication.toml",
      `[[presets]]\nid="print"\nformat="pdf"\n[presets.pdf]\nlayout="flow"\ninclude_cover=${cover}\ninclude_toc=${toc}\n`,
    );
    const print = preparePublication(file, "pdf", runtime, "print");
    const html = publicationHtml(print);
    assert.equal(html.includes('<section class="cover front-page'), cover);
    assert.equal(html.includes('<nav class="toc front-page'), toc);
    if (cover && toc)
      assert(
        html.indexOf('<section class="cover front-page') <
          html.indexOf('<nav class="toc front-page'),
      );
    assert.equal(print.configuration.publication.pdf.chapter_break, "none");
  }
  mdk.setMdkMode(file, "default");
  const after = preparePublication(file, "pdf", runtime, "print");
  assert.equal(after.configuration.publication.pdf.include_toc, true);
  assert.equal(after.configuration.publication.pdf.chapter_break, "none");
});

test("complete delivery checks draft links but a selected EPUB preset is independent", async () => {
  const file = at("publish.mdk");
  mdk.packMdk("docs/examples/v2/book", file);
  mdk.createTextFile(file, "markdown/draft.md", "[Missing](absent.md)");
  assert.equal(mdk.validateMdk(file).valid, false);
  const result = preparePublication(file, "epub", {
    engine: "test",
    assetDirectory: path.resolve("assets/export"),
    localConfiguration: () => null,
    verifyImages() {},
  });
  assert.deepEqual(
    result.issues.filter(({ severity }) => severity === "error"),
    [],
  );
  const bytes = await buildEpub(result);
  const zip = new AdmZip(bytes);
  assert.match(zip.readAsText("EPUB/package.opf"), /dcterms:modified/);
  assert.match(zip.readAsText("EPUB/package.opf"), /properties="cover-image"/);
  assert.match(zip.readAsText("EPUB/nav.xhtml"), /chapter-0004\.xhtml/);
});

test("v2 optional contents.md uses node labels and survives standard ZIP extraction", () => {
  const file = at("contents.mdk");
  const project = mdk.createMdkProject(file, "default");
  const rootNode = project.contents.entries[0];
  mdk.addMdkGroup(file, "资源目录", rootNode.id);
  const updated = mdk.openMdkProject(file);
  updated.settings.export.mdk.generate_contents_markdown = true;
  mdk.updateMdkSettings(file, updated.settings);
  const unlocked = at("unzipped");
  mdk.unpackMdk(file, unlocked);
  assert.match(
    fs.readFileSync(path.join(unlocked, "contents.md"), "utf8"),
    /\[1 001\]\(markdown\/001.md\).*\n {2}- 1.1 资源目录/,
  );
  assert(fs.existsSync(path.join(unlocked, "mdk.toml")));
  assert(!fs.existsSync(path.join(unlocked, ".mdk-mode")));
});

test("ordinary entries can use small ZIP64 sizes and an unsigned descriptor", () => {
  const original = fixture("zip64-template.mdk", {
    "extra.txt": "descriptor test",
  });
  const input = fs.readFileSync(original),
    end = input.length - 22,
    start = input.readUInt32LE(end + 16);
  const name = Buffer.from("extra.txt"),
    body = Buffer.from("descriptor test"),
    compressed = deflateRawSync(body);
  let offset = start;
  while (
    !input
      .subarray(offset + 46, offset + 46 + input.readUInt16LE(offset + 28))
      .equals(name)
  )
    offset +=
      46 +
      input.readUInt16LE(offset + 28) +
      input.readUInt16LE(offset + 30) +
      input.readUInt16LE(offset + 32);
  const localOffset = input.readUInt32LE(offset + 42);
  const extra = Buffer.alloc(20);
  extra.writeUInt16LE(1, 0);
  extra.writeUInt16LE(16, 2);
  const local = Buffer.from(input.subarray(localOffset, localOffset + 30));
  local.writeUInt16LE(45, 4);
  local.writeUInt16LE(0x808, 6);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(0xffffffff, 18);
  local.writeUInt32LE(0xffffffff, 22);
  local.writeUInt16LE(extra.length, 28);
  const descriptor = Buffer.alloc(20);
  descriptor.writeUInt32LE(crc32(body), 0);
  descriptor.writeBigUInt64LE(BigInt(compressed.length), 4);
  descriptor.writeBigUInt64LE(BigInt(body.length), 12);
  const central = Buffer.from(input.subarray(offset, offset + 46));
  central.writeUInt16LE(45, 6);
  central.writeUInt16LE(0x808, 8);
  central.writeUInt32LE(0xffffffff, 20);
  central.writeUInt32LE(0xffffffff, 24);
  central.writeUInt16LE(extra.length, 30);
  const endRecord = Buffer.from(input.subarray(end));
  endRecord.writeUInt32LE(input.readUInt32LE(end + 12) + extra.length, 12);
  const localData = Buffer.concat([local, name, extra, compressed, descriptor]);
  endRecord.writeUInt32LE(localOffset + localData.length, 16);
  const exact = Buffer.from(extra);
  exact.writeBigUInt64LE(BigInt(body.length), 4);
  exact.writeBigUInt64LE(BigInt(compressed.length), 12);
  const zip64 = at("zip64.mdk");
  fs.writeFileSync(
    zip64,
    Buffer.concat([
      input.subarray(0, localOffset),
      localData,
      input.subarray(start, offset),
      central,
      name,
      exact,
      endRecord,
    ]),
  );
  assert.equal(
    mdk.readMdkTextFile(zip64, "extra.txt").content,
    body.toString(),
  );
  assert.equal(mdk.validateMdk(zip64).valid, true);
});
