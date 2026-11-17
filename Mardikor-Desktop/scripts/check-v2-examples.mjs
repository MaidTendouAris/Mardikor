// Checks the controlled v2 final fixtures, not arbitrary/untrusted MDK files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import MarkdownIt from 'markdown-it';
import AdmZip from 'adm-zip';

const root = fileURLToPath(new URL('../', import.meta.url));
const examples = path.join(root, 'docs/examples/v2');
const output = path.join(root, '.test-artifacts/mdk-v2-examples');
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const spec = read(path.join(root, 'docs/MDK Format Specification v2.md'));
const reference = read(path.join(root, 'docs/MDK v2 Settings Reference.md'));
const mime = Buffer.from('application/vnd.mardikor.mdk+zip');
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// oxlint-disable-next-line eslint/no-control-regex -- Format validation explicitly rejects C0 and C1 controls.
const cc = /[\u0000-\u001f\u007f-\u009f]/u;
const markdown = new MarkdownIt('commonmark', { html: true }).enable(['table', 'strikethrough']);
const report = { revision: 'v2 Final (2026-11-16)', snippets: 0, tomlSnippets: 0, localDocLinks: 0, projects: [] };

assert(spec.includes('版本：2 · 定稿日期：2026-11-16') && spec.includes('状态：已定稿。'));
assert(reference.includes('定稿日期：2026-11-16 · 对应 MDK v2 定稿版'));
assert(!/Draft \d|本草案|此草案/.test(spec + reference), 'Stale draft status in normative documents');

function filesIn(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    assert(!entry.isSymbolicLink(), `Fixture must not be a symlink: ${entry.name}`);
    const name = prefix + entry.name;
    return entry.isDirectory() ? filesIn(path.join(directory, entry.name), name + '/') : [name];
  }).sort();
}

function packagePath(value) {
  assert(typeof value === 'string' && value.length > 0);
  assert(!/[\\:]/u.test(value) && !cc.test(value), `Unsafe package path: ${JSON.stringify(value)}`);
  assert(value.split('/').every(part => part && part !== '.' && part !== '..'), value);
  return value;
}

function resolveLocal(source, target, files) {
  assert(!cc.test(target) && !target.includes('\\'));
  assert(!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target), 'Fixture expects a local reference');
  const hash = target.indexOf('#');
  const beforeHash = hash < 0 ? target : target.slice(0, hash);
  const fragment = hash < 0 ? '' : decodeURIComponent(target.slice(hash + 1));
  const query = beforeHash.indexOf('?');
  assert(query < 0 || query === beforeHash.length - 1, 'No query semantics in core');
  const relative = query < 0 ? beforeHash : beforeHash.slice(0, query);
  const parts = source.split('/').slice(0, -1);
  if (relative) {
    for (const encoded of relative.split('/')) {
      assert(encoded, 'Empty URL segment');
      const part = decodeURIComponent(encoded);
      assert(!/[/\\:]/u.test(part) && !cc.test(part));
      if (part === '..') assert(parts.pop() !== undefined, 'Path escapes package');
      else if (part !== '.') parts.push(part);
    }
  }
  const name = relative ? packagePath(parts.join('/')) : source;
  assert(!name.startsWith('state/'), 'Persistent reference to state');
  assert(files.has(name), `Missing file or directory target: ${name}`);
  return { name, fragment };
}

function inlineText(tokens) {
  return tokens.map(token => {
    if (token.type === 'image') return inlineText(token.children ?? []);
    if (['text', 'code_inline', 'html_inline'].includes(token.type)) return token.content;
    return ['softbreak', 'hardbreak'].includes(token.type) ? ' ' : '';
  }).join('');
}

// These fixtures only exercise characters whose properties are unchanged in Unicode 15.1.
// Runtime Unicode properties here are not a general version-pinned anchor implementation.
function anchors(tokens) {
  const used = new Set();
  tokens.forEach((token, index) => {
    if (token.type !== 'heading_open') return;
    const text = inlineText(tokens[index + 1].children).normalize('NFC')
      .replace(/[A-Z]/g, c => c.toLowerCase()).replace(/\p{White_Space}+/gu, '-')
      .replace(/[^\p{L}\p{M}\p{N}_-]/gu, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const base = 'h-' + (text || 'section');
    let name = base;
    for (let suffix = 2; used.has(name); suffix++) name = `${base}-${suffix}`;
    used.add(name);
  });
  return used;
}

function walkTokens(tokens, callback) {
  for (const token of tokens) {
    callback(token);
    if (token.children) walkTokens(token.children, callback);
  }
}

function sequence(contents, files) {
  const documents = contents.documents ?? [];
  const nodes = contents.nodes ?? [];
  assert(Array.isArray(documents) && Array.isArray(nodes));
  const docs = new Map(), paths = new Set(), byId = new Map(), siblings = new Map();
  for (const doc of documents) {
    assert(idPattern.test(doc.id) && !docs.has(doc.id), 'Invalid/duplicate document ID');
    packagePath(doc.path);
    assert(doc.path.startsWith('markdown/') && doc.path.endsWith('.md') && files.has(doc.path));
    assert(!paths.has(doc.path), 'Duplicate document path');
    docs.set(doc.id, doc); paths.add(doc.path);
  }
  for (const node of nodes) {
    assert(idPattern.test(node.id) && !byId.has(node.id), 'Invalid/duplicate node ID');
    assert(Number.isInteger(node.order) && node.order >= 1 && node.order <= 2147483647);
    assert(['group', 'document'].includes(node.kind));
    if (node.kind === 'document') assert(docs.has(node.document));
    else assert(node.document === undefined && typeof node.title === 'string' && node.title.trim());
    byId.set(node.id, node);
    const parent = node.parent ?? '';
    const group = siblings.get(parent) ?? [];
    assert(!group.some(other => other.order === node.order), 'Duplicate sibling order');
    group.push(node); siblings.set(parent, group);
  }
  for (const node of nodes) assert(node.parent === undefined || byId.has(node.parent), 'Missing parent');
  const visited = new Set(), result = [];
  function visit(parent) {
    for (const node of (siblings.get(parent) ?? []).sort((a, b) => a.order - b.order)) {
      assert(!visited.has(node.id), 'Cycle');
      visited.add(node.id);
      if (node.kind === 'document') result.push(node.id);
      visit(node.id);
    }
  }
  visit('');
  assert.equal(visited.size, nodes.length, 'Unreachable nodes/cycle');
  return result;
}

for (const [, name, language, content] of spec.matchAll(/<!-- example: ([^\n]+) -->\n```([^\n]*)\n([\s\S]*?)\n```/g)) {
  packagePath(name);
  assert.equal(read(path.join(examples, name)), content + '\n', `Spec/example drift: ${name}`);
  report.snippets++;
  if (language === 'toml') { parse(content); report.tomlSnippets++; }
}
assert.equal(report.snippets, 16);
assert.equal(report.tomlSnippets, 10);

const templateSource = read(path.join(examples, 'settings.full.toml'));
assert(templateSource.startsWith('# MDK v2 settings.toml 完整字段示例，2026-11-16，对应 v2 定稿版。'));
const template = parse(templateSource);
const fontExample = parse(templateSource.split('\n').filter(line =>
  /^# (?:\[\[font_sets\]\]|(?:id|regular|bold|italic|bold_italic) =)/.test(line)
).map(line => line.slice(2)).join('\n'));
const fontKeys = Object.keys(fontExample.font_sets[0]);
assert.deepEqual(fontKeys, ['id', 'regular', 'bold', 'italic', 'bold_italic']);
const fieldNames = new Set([...reference.matchAll(/^\| `([^`]+)` \|[^\n]* \| [SRV](?:，[^|]*)? \|$/gm)].map(match => match[1]));
function flatten(value, prefix = '') {
  return Object.entries(value).flatMap(([key, item]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    return item && typeof item === 'object' && !Array.isArray(item) ? flatten(item, name) : [name];
  });
}
const fields = flatten(template);
assert.equal(fieldNames.size, 179);
assert.equal(fields.length, 174);
assert.deepEqual(new Set([...fields, ...fontKeys.map(key => `font_sets[].${key}`)]), fieldNames);
report.settings = { documentedFields: fieldNames.size, activeTemplateFields: fields.length, commentedFontFields: fontKeys.length };

const expected = {
  minimal: { files: 3, nodes: [] },
  book: { files: 9, nodes: ['node-intro', 'node-road', 'node-home', 'node-intro-again'] },
  comic: { files: 8, nodes: ['node-one', 'node-two', 'node-three'] },
  extension: { files: 4, nodes: [] },
};
fs.mkdirSync(output, { recursive: true });
for (const [name, expectation] of Object.entries(expected)) {
  const directory = path.join(examples, name);
  const files = new Map(filesIn(directory).map(file => [packagePath(file), fs.readFileSync(path.join(directory, file))]));
  assert.equal(files.size, expectation.files);
  assert(files.get('mimetype').equals(mime));
  for (const [file, bytes] of files) if (file.endsWith('.toml')) {
    assert(!bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), file);
    parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  const config = parse(files.get('mdk.toml').toString());
  assert.equal(config.format_version, 2);
  assert(/^format_version = 2\r?$/m.test(files.get('mdk.toml').toString()));
  assert(idPattern.test(config.project_id));
  assert(['default', 'book', 'comic'].includes(config.mode ?? 'default'));
  const order = sequence(parse(files.get('contents.toml').toString()), files);
  assert.deepEqual(order, expectation.nodes);
  const parsed = new Map([...files].filter(([file]) => file.endsWith('.md')).map(([file, bytes]) => {
    const tokens = markdown.parse(bytes.toString().replace(/^\uFEFF/, ''), {});
    return [file, { tokens, anchors: anchors(tokens) }];
  }));
  let links = 0;
  for (const [source, { tokens }] of parsed) walkTokens(tokens, token => {
    const target = token.type === 'link_open' ? token.attrGet('href') : token.type === 'image' ? token.attrGet('src') : null;
    if (target === null) return;
    const resolved = resolveLocal(source, target, files);
    if (resolved.fragment) assert(parsed.get(resolved.name)?.anchors.has(resolved.fragment));
    links++;
  });
  if (config.metadata?.cover) assert(files.has(packagePath(config.metadata.cover)));
  if (files.has('publication.toml')) {
    const publication = parse(files.get('publication.toml').toString());
    const ids = new Set();
    for (const preset of publication.presets) {
      assert(idPattern.test(preset.id) && !ids.has(preset.id)); ids.add(preset.id);
      assert(['pdf', 'epub'].includes(preset.format));
      assert(preset[preset.format] && !preset[preset.format === 'pdf' ? 'epub' : 'pdf']);
      const target = preset[preset.format];
      if (preset.format === 'pdf') {
        assert(['flow', 'fixed'].includes(target.layout));
        assert((target.margin_left ?? 20) + (target.margin_right ?? 20) < (target.page_width ?? 210));
        assert((target.margin_top ?? 20) + (target.margin_bottom ?? 20) < (target.page_height ?? 297));
        assert(target.layout !== 'fixed' || target.chapter_break === undefined);
      } else {
        assert(['fixed', 'reflowable'].includes(target.layout));
        if (target.layout === 'reflowable') for (const key of ['spread', 'first_single', 'page_width', 'page_height']) assert(!(key in target));
        for (const key of ['title', 'language', 'identifier']) assert(config.metadata?.[key]);
      }
      if (target.include_cover) assert(config.metadata?.cover);
    }
    assert(publication.default_preset === undefined || ids.has(publication.default_preset));
  }

  const zip = new AdmZip({ noSort: true });
  for (const file of ['mimetype', 'mdk.toml', ...[...files.keys()].filter(file => !['mimetype', 'mdk.toml'].includes(file))]) {
    zip.addFile(file, files.get(file));
    const entry = zip.getEntry(file);
    entry.header.flags = 0x800;
    entry.header.method = ['mimetype', 'mdk.toml'].includes(file) ? 0 : 8;
    entry.header.time = new Date(2026, 10, 16, 0, 0, 0);
  }
  const buffer = zip.toBuffer();
  let offset = 0;
  for (const file of ['mimetype', 'mdk.toml']) {
    assert.equal(buffer.readUInt32LE(offset), 0x04034b50);
    assert.equal(buffer.readUInt16LE(offset + 6), 0x800);
    assert.equal(buffer.readUInt16LE(offset + 8), 0);
    const size = buffer.readUInt32LE(offset + 18);
    assert.equal(size, buffer.readUInt32LE(offset + 22));
    assert(size <= 65536);
    const length = buffer.readUInt16LE(offset + 26), extra = buffer.readUInt16LE(offset + 28);
    assert.equal(extra, 0);
    assert.equal(buffer.subarray(offset + 30, offset + 30 + length).toString(), file);
    offset += 30 + length + extra + size;
  }
  const reopened = new AdmZip(buffer);
  assert.equal(reopened.getEntryCount(), files.size);
  for (const [file, bytes] of files) assert(reopened.readFile(file).equals(bytes), `ZIP round trip: ${file}`);
  fs.writeFileSync(path.join(output, `${name}.mdk`), buffer);
  report.projects.push({ name, files: files.size, readingSequence: order, links, bytes: buffer.length });
}
assert(fs.readFileSync(path.join(examples, 'book/resources/cover.svg')).equals(fs.readFileSync(path.join(examples, 'comic/resources/scene.svg'))));

const docs = ['docs/MDK Format Specification v2.md', 'docs/MDK v2 Settings Reference.md', 'docs/examples/v2/README.md', 'docs/MDK v2 Finalization.md'];
assert(read(path.join(examples, 'README.md')).startsWith('# MDK v2 定稿版工程示例'));
for (const file of docs) walkTokens(markdown.parse(read(path.join(root, file)), {}), token => {
  if (token.type !== 'link_open') return;
  const target = token.attrGet('href');
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) return;
  const absolute = path.resolve(root, path.dirname(file), decodeURIComponent(target.split('#')[0]));
  assert(fs.existsSync(absolute), `Broken local documentation link: ${file} -> ${target}`);
  report.localDocLinks++;
});
const caseSection = spec.slice(spec.indexOf('## 17.'), spec.indexOf('## 18.'));
assert.equal(markdown.parse(caseSection, {}).filter(token => token.type === 'table_open').length, 1);
assert(!markdown.parse(caseSection, {}).some(token => token.type === 'inline' && token.content.startsWith('|')), 'Detached case table rows');
report.conformanceCases = caseSection.split('\n').filter(line => line.startsWith('|')).length - 2;
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
