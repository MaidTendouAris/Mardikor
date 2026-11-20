import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { withAccess } from "../electron/access-session";
import {
  chunkSize,
  decodeEnvelope,
  deriveEnvelopeKey,
  encodeEnvelope,
  initEnvelopeCrypto,
  inspectEnvelope,
  passwordBytes,
  readEnvelopeHeader,
} from "../electron/envelope";
import {
  publishEnvelopeOutput,
  runEnvelopeTask,
} from "../electron/envelope-operations";
import {
  compressEnvelope,
  decompressEnvelope,
  verifyZstdFrame,
} from "../electron/envelope-zstd";
import {
  openMdkProject,
  packMdk,
  readMdkTextFile,
  saveMdkSnapshot,
} from "../electron/mdk";
import { AppState } from "../electron/state";

// Generated with PyNaCl 1.6.2 calling native libsodium. Salt is bytes 0..15,
// nonce 16..39, secretstream header 40..63, and DEK 64..95.
const nativeVector = Buffer.from(
  "4d444b450d0a1a0a010090000001010000001000000000000000000000000000" +
    "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f2021222324252627" +
    "28292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f76f37c6249cc0ee9b1aa9027a79707" +
    "4697e40796fef8e662ac6acbf8024f726742083997695bc1039ca56f1572102d4d" +
    "49000000e6bead242e8a2c18d46342c64bc72391fd8e98ae4ec72d53728fb4ef9923b9b4eafc9b0a8d400eda2ebf44e4e8fea13abb89dfdf380b5371c578d1fb68e762f6160b02df921b25ce74" +
    "49000000782b129925b5050ed5d337df5d7e0b61e314305d4c75ccc09125afcaf66bedc54702b369e61f0e8f01c5b46b9431ec4ca39f81c7ed63461ed7b39b129dac87278a0da152cde9554e0c",
  "hex",
);

test("MDKE authenticates native libsodium data and final records of the same size", async () => {
  await initEnvelopeCrypto();
  const header = readEnvelopeHeader(nativeVector);
  const key = deriveEnvelopeKey(" 中文🙂e\u0301 ", header.salt);
  assert.equal(
    Buffer.from(key.key).toString("hex"),
    "6aa69773a8aea077650791abd20d3ecfb999864a9a8f8d1cc838132268b308d3",
  );
  assert.deepEqual(
    decodeEnvelope(nativeVector, key),
    Buffer.from(Array.from({ length: 56 }, (_, index) => index)),
  );
  const altered = Buffer.from(nativeVector);
  altered[150] ^= 1;
  assert.throws(() => decodeEnvelope(altered, key));
  assert.throws(() =>
    decodeEnvelope(Buffer.concat([nativeVector, Buffer.of(0)]), key),
  );
  assert.throws(() => decodeEnvelope(nativeVector.subarray(0, -1), key));
  const wrong = deriveEnvelopeKey("中文🙂é", header.salt);
  assert.throws(() => decodeEnvelope(nativeVector, wrong));
  key.key.fill(0);
  wrong.key.fill(0);
});

test("passphrases retain spaces and width and reject invalid code points or lengths", () => {
  assert.deepEqual(passwordBytes(" e\u0301 "), Buffer.from(" é "));
  assert.notDeepEqual(passwordBytes("A"), passwordBytes("Ａ"));
  assert.equal(passwordBytes("🙂".repeat(256)).length, 1024);
  for (const invalid of [
    "",
    "\0",
    "\r",
    "\n",
    "\uD800",
    "\uDC00",
    "🙂".repeat(257),
    "🙂".repeat(1025),
  ])
    assert.throws(() => passwordBytes(invalid));
});

test("STORE checks chunk framing and Zstandard checks frame structure and checksum", async () => {
  await initEnvelopeCrypto();
  const access = deriveEnvelopeKey("framing");
  for (const size of [1, chunkSize, chunkSize + 1]) {
    const data = randomBytes(size);
    for (const key of [undefined, access]) {
      const encoded = encodeEnvelope(data, "MDKE", "store", key);
      assert.deepEqual(decodeEnvelope(encoded, key), data);
      const reserved = Buffer.from(encoded);
      reserved[20] = 1;
      assert.throws(() => inspectEnvelope(reserved));
      const oversized = Buffer.from(encoded);
      oversized.writeUInt32LE(0xffffffff, key ? 144 : 32);
      assert.throws(() => decodeEnvelope(oversized, key));
    }
  }
  const data = Buffer.alloc(9 * chunkSize, 0x5a);
  const encoded = compressEnvelope(data);
  assert.deepEqual(decompressEnvelope(encoded, BigInt(data.length)), data);
  assert.throws(() =>
    verifyZstdFrame(Buffer.concat([encoded, encoded]), BigInt(data.length)),
  );
  const noChecksum = Buffer.from(encoded);
  noChecksum[4] &= ~4;
  assert.throws(() => verifyZstdFrame(noChecksum, BigInt(data.length)));
  const corrupt = Buffer.from(encoded);
  corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => decompressEnvelope(corrupt, BigInt(data.length)));
  access.key.fill(0);
});

test("protected project writes, recovery and all four distribution combinations retain the correct layer", async (t) => {
  const root = fs.mkdtempSync(path.resolve(".test-artifacts", "envelope-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "book.mdk");
  packMdk("docs/examples/v2/book", file);
  const plain = fs.readFileSync(file);
  const protectedOutput = await runEnvelopeTask({
    kind: "set-access",
    file,
    passphrase: "内层",
  });
  assert.ok("bytes" in protectedOutput && protectedOutput.access);
  publishEnvelopeOutput(file, file, protectedOutput, true);
  const access = protectedOutput.access;
  const previous = fs.readFileSync(file);
  assert.deepEqual(decodeEnvelope(previous, access), plain);
  assert.throws(() => openMdkProject(file));
  await assert.rejects(
    runEnvelopeTask({ kind: "unlock", file, passphrase: "错误" }),
  );
  const marker = "protected recovery text: 6881b45d";
  const session = { file, ...access };
  withAccess(session, () => {
    const project = openMdkProject(file);
    assert.equal(project.protected, true);
    saveMdkSnapshot(file, {
      revision: project.revision,
      text: { path: "markdown/intro.md", content: marker },
    });
    assert.equal(readMdkTextFile(file, "markdown/intro.md").content, marker);
  });
  const current = fs.readFileSync(file);
  assert.equal(inspectEnvelope(current).kind, "MDKP");
  assert.notDeepEqual(current.subarray(48, 144), previous.subarray(48, 144));
  assert.equal(current.includes(marker), false);
  const profile = path.join(root, "profile");
  const state = new AppState(profile);
  const draft = {
    revision: "revision",
    text: { path: "markdown/intro.md", content: marker },
  };
  state.recovery(file, draft, "first", access);
  const drafts = path.join(profile, "recovery");
  const [draftFile] = fs.readdirSync(drafts);
  assert.match(draftFile, /\.protected\.draft$/);
  assert.equal(
    fs.readFileSync(path.join(drafts, draftFile)).includes(marker),
    false,
  );
  assert.deepEqual(
    new AppState(profile).recovery(file, undefined, "restart", access),
    draft,
  );

  const plainFile = path.join(root, "plain.mdk");
  fs.writeFileSync(plainFile, plain);
  for (const source of [plainFile, file]) {
    for (const passphrase of [undefined, "外层"]) {
      const packed = await runEnvelopeTask({
        kind: "pack",
        file: source,
        passphrase,
      });
      assert.ok("bytes" in packed);
      const capsule = path.join(
        root,
        source === file ? "protected.mdke" : "plain.mdke",
      );
      fs.writeFileSync(capsule, packed.bytes);
      assert.equal(
        readEnvelopeHeader(Buffer.from(packed.bytes)).codec,
        source === file ? "store" : "zstd",
      );
      const extracted = await runEnvelopeTask({
        kind: "extract",
        file: capsule,
        passphrase,
      });
      assert.ok("bytes" in extracted);
      assert.deepEqual(Buffer.from(extracted.bytes), fs.readFileSync(source));
      assert.equal(
        extracted.report?.innerProject,
        source === file ? "unverified" : "pass",
      );
      const rekeyed = await runEnvelopeTask({
        kind: "rekey",
        file: capsule,
        passphrase,
        nextPassphrase: "外层二",
      });
      assert.ok("bytes" in rekeyed);
      fs.writeFileSync(capsule, rekeyed.bytes);
      const fromNewKey = await runEnvelopeTask({
        kind: "extract",
        file: capsule,
        passphrase: "外层二",
      });
      assert.ok("bytes" in fromNewKey);
      assert.deepEqual(Buffer.from(fromNewKey.bytes), fs.readFileSync(source));
    }
  }
  access.key.fill(0);
});
