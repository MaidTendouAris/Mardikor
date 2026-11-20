import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as mdk from "../electron/mdk";
import {
  FileRegion,
  FileSnapshot,
  hashFile,
  StoreArchive,
  StoreEntry,
} from "../electron/archive-io";
import { readArchiveFile } from "../electron/archive";
import { writeStoreArchive } from "../electron/archive-write";
import { withArchiveOperation } from "../electron/archive-operation";

const root = path.resolve(".test-artifacts");
fs.mkdirSync(root, { recursive: true });
const directory = fs.mkdtempSync(path.join(root, "streaming-attachments-"));
const at = (name: string) => path.join(directory, name);
const mib = 1024 * 1024;
const sha = (name: string) => hashFile(new FileSnapshot(name));
const marker = "MdkTempResourceMarker9876543210";

function makeSource(name: string, size: number) {
  const file = at(name);
  const fd = fs.openSync(file, "wx");
  try {
    fs.writeSync(
      fd,
      Buffer.from("\0\0\0\x18ftypisom ordinary attachment", "latin1"),
    );
    fs.ftruncateSync(fd, size);
    fs.writeSync(fd, Buffer.of(0xfe), 0, 1, size - 1);
  } finally {
    fs.closeSync(fd);
  }
  return file;
}

try {
  const file = at("recording.mdk");
  const source = makeSource("camera.mp4", 900 * mib);
  const base = mdk.createMdkProject(file, "00");
  const insertion = {
    revision: base.revision,
    text: { path: "markdown/001.md", content: "# Report\n\n" + marker },
    marker,
  };
  const cancel = new Int32Array(new SharedArrayBuffer(4));
  assert.throws(
    () =>
      withArchiveOperation(
        cancel,
        (progress) => {
          if (progress.bytes > 0 && !progress.committing)
            Atomics.compareExchange(cancel, 0, 0, 1);
        },
        () => mdk.insertMdkResources(file, [source], insertion),
      ),
    /取消|cancel/,
  );
  assert.equal(mdk.fileRevision(file), base.revision);
  assert.ok(!fs.readdirSync(directory).some((name) => name.endsWith(".tmp")));
  const inserted = mdk.insertMdkResources(file, [source], insertion);
  const internal = inserted.resources[0].path;
  assert.match(
    inserted.content,
    /\[camera.mp4\]\(<\.\.\/resources\/video\/camera.mp4>\)/,
  );
  assert.equal(inserted.resources[0].bytes, 900 * mib);
  mdk.saveMdkTextFile(
    file,
    "markdown/001.md",
    inserted.content + "\n\nSaved outside old limits.",
  );
  const project = mdk.openMdkProject(file);
  assert.equal(
    project.files.find((entry) => entry.path === internal)?.bytes,
    900 * mib,
  );
  assert.ok(mdk.validateMdk(file).valid);
  const entry = mdk.mdkAttachment(file, internal);
  const last: Buffer[] = [];
  assert.ok(!Buffer.isBuffer(entry.data));
  for await (const chunk of entry.data.stream(
    entry.header.size - 2,
    entry.header.size - 1,
  ))
    last.push(chunk);
  assert.deepEqual(Buffer.concat(last), Buffer.of(0, 0xfe));
  const delivery = at("delivery.mdk");
  mdk.exportMdk(file, delivery, project.revision);
  const extracted = at("camera-extracted.mp4");
  mdk
    .prepareMdkResourceExtraction(
      delivery,
      [internal],
      mdk.fileRevision(delivery),
    )
    .extract(extracted);
  const hash = sha(source);
  assert.equal(sha(extracted), hash);
  console.log(
    `900 MiB drag, save, delivery and extraction passed. SHA-256 ${hash}`,
  );

  if (
    process.argv.includes("--zip64") ||
    process.env.MARDIKOR_TEST_ZIP64 === "1"
  ) {
    const large = makeSource("zip64.dat", 0x100000000 + 1);
    const largeProject = at("zip64.mdk");
    const starter = mdk.createMdkProject(largeProject, "00");
    const tail = at("end");
    fs.writeFileSync(tail, "after the 32-bit offset");
    const final = mdk.importMdkResourceBatch(
      largeProject,
      "resources/other",
      [large, tail],
      starter.revision,
    ).project;
    const zip64name = "resources/other/zip64.dat";
    assert.equal(
      mdk.mdkAttachment(largeProject, zip64name).header.size,
      0x100000000 + 1,
    );
    assert.equal(
      mdk
        .mdkAttachment(largeProject, "resources/other/end")
        .getData()
        .toString(),
      "after the 32-bit offset",
    );
    const output = at("zip64-extracted.dat");
    mdk
      .prepareMdkResourceExtraction(largeProject, [zip64name], final.revision)
      .extract(output);
    assert.equal(sha(large), sha(output));
    console.log(
      "ZIP64 4 GiB + 1 entry length and subsequent offset round-tripped.",
    );

    const entries = readArchiveFile(new FileSnapshot(largeProject)).zip;
    entries.deleteFile(zip64name);
    entries.deleteFile("resources/other/end");
    const payload = new FileSnapshot(large);
    for (let i = 0; i < 4; i++)
      entries.set(
        new StoreEntry(
          `resources/other/part-${i}`,
          new FileRegion(payload, i * 0x40000000, 0x40000000),
        ),
      );
    entries.add("resources/other/tail", Buffer.from("offset only"));
    const offsets = at("offsets.mdk");
    const offsetFd = fs.openSync(offsets, "wx");
    try {
      writeStoreArchive(offsetFd, entries, offsets);
    } finally {
      fs.closeSync(offsetFd);
    }
    assert.equal(
      mdk.mdkAttachment(offsets, "resources/other/tail").getData().toString(),
      "offset only",
    );

    const countArchive = new StoreArchive(
      Buffer.alloc(0),
      entries.getEntries().slice(0, 3),
    );
    for (let i = 3; i < 0xffff; i++)
      countArchive.add(`extra/${i}`, Buffer.alloc(0));
    const countPath = at("count.mdk");
    const countFd = fs.openSync(countPath, "wx");
    try {
      writeStoreArchive(countFd, countArchive, countPath);
    } finally {
      fs.closeSync(countFd);
    }
    const index = readArchiveFile(new FileSnapshot(countPath));
    assert.equal(index.zip.getEntries().length, 0xffff);
    console.log(
      "ZIP64 offset-only entries and the 65,535-entry sentinel round-tripped.",
    );
  }
  console.log(
    `Peak RSS ${Math.round(process.resourceUsage().maxRSS / 1024)} MiB`,
  );
} finally {
  if (
    path.dirname(path.resolve(directory)) === root &&
    fs.realpathSync(directory) === directory
  )
    fs.rmSync(directory, { recursive: true, force: true });
}
