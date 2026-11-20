import { parentPort, workerData } from "node:worker_threads";
import { withAccess, type AccessSession } from "./access-session";
import { initEnvelopeCrypto } from "./envelope";
import { deserialize, serialize } from "node:v8";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
} from "pdf-lib";
import type {
  PublicationConfiguration,
  PublicationFormat,
} from "../shared/publication";
import {
  escapeXml,
  preparePublication,
  type PreparedPublication,
} from "./publication";
import { publicationHtml } from "./publication-render";
import { publicationRasterSize } from "./media";
import { pdfCjkAliases, restorePdfSourceCharacters } from "./pdf-text";
import { buildEpub } from "./epub";
import { t, setAppLocale, type AppLocale } from "../shared/i18n";

type PdfDetails = Pick<
  PreparedPublication,
  "configuration" | "font" | "fontText" | "fingerprint"
> & { headings: string[] };
export type PublicationWork =
  | {
      kind: "prepare";
      file: string;
      format: PublicationFormat;
      presetId?: string;
      engine: string;
      assetDirectory: string;
      configuration: PublicationConfiguration | null;
      access?: AccessSession;
    }
  | { kind: "pdf-pages"; bytes: Buffer; first: number }
  | { kind: "pdf-finish"; bytes: Buffer; details: PdfDetails }
  | { kind: "epub"; prepared: PreparedPublication };

async function run(work: PublicationWork) {
  if (work.kind === "prepare") {
    if (work.access) await initEnvelopeCrypto();
    const prepared = withAccess(work.access, () => preparePublication(
      work.file,
      work.format,
      {
        engine: work.engine,
        assetDirectory: work.assetDirectory,
        localConfiguration: () => work.configuration,
        verifyImages: (images) => {
          for (const image of images) {
            try {
              publicationRasterSize(image.data);
            } catch (error) {
              throw new Error(image.path + t("：") + String(error));
            }
          }
        },
      },
      work.presetId,
    ));
    if (!prepared.issues.some(({ severity }) => severity === "error"))
      prepared.renderedHtml = publicationHtml(prepared);
    return prepared;
  }
  if (work.kind === "epub") return buildEpub(work.prepared);
  const document = await PDFDocument.load(work.bytes, {
    updateMetadata: false,
  });
  if (work.kind === "pdf-pages") {
    const pages = document.getPages();
    const pageNumber = new Map(
      pages.map((page, index) => [page.ref.toString(), work.first + index]),
    );
    const destinations = document.catalog.lookupMaybe(
      PDFName.of("Dests"),
      PDFDict,
    );
    const labels = Object.fromEntries(
      (destinations?.entries() ?? []).flatMap(([name, value]) => {
        const target = document.context
          .lookupMaybe(value, PDFArray)
          ?.get(0)
          ?.toString();
        const label = target && pageNumber.get(target);
        return label ? [[name.decodeText(), label]] : [];
      }),
    );
    return { labels, count: pages.length };
  }
  const { details } = work;
  const { metadata, pdf, v2 } = details.configuration.publication;
  // Chromium can repeat the complete heading in a tagged PDF bookmark.
  const headings = new Set(details.headings);
  const repeated = new Map(
    [...headings].map((title) => [title + title, title]),
  );
  const titleKey = PDFName.of("Title");
  const firstKey = PDFName.of("First");
  const nextKey = PDFName.of("Next");
  const root = document.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
  const stack = [root?.lookupMaybe(firstKey, PDFDict)];
  while (stack.length) {
    const bookmark = stack.pop();
    if (!bookmark) continue;
    const text = bookmark
      .lookupMaybe(titleKey, PDFString, PDFHexString)
      ?.decodeText();
    const title = text && !headings.has(text) ? repeated.get(text) : undefined;
    if (title) bookmark.set(titleKey, PDFHexString.fromText(title));
    stack.push(
      bookmark.lookupMaybe(nextKey, PDFDict),
      bookmark.lookupMaybe(firstKey, PDFDict),
    );
  }
  restorePdfSourceCharacters(
    document,
    pdfCjkAliases(details.font, details.fontText),
  );
  const pages = document.getPageCount();
  if (v2) {
    const context = document.context;
    for (const [, object] of context.enumerateIndirectObjects()) {
      if (
        !(object instanceof PDFDict) ||
        object.get(PDFName.of("Type"))?.toString() !== "/Font"
      )
        continue;
      const subtype = object.get(PDFName.of("Subtype"))?.toString();
      if (subtype === "/Type0" || subtype === "/Type3") {
        // Skia represents embedded CFF glyphs with a Type 3 font and a
        // ToUnicode stream. CharProcs embeds the glyph shapes in this case.
        const mapping = object.get(PDFName.of("ToUnicode"));
        if (
          mapping &&
          context.lookup(mapping) instanceof PDFRawStream &&
          (subtype === "/Type0" ||
            (object.lookupMaybe(PDFName.of("CharProcs"), PDFDict)?.keys()
              .length ?? 0) > 0)
        )
          continue;
        throw new Error(t("PDF 使用了未嵌入的字体。") + " " + subtype);
      }
      const descriptor = object.lookupMaybe(
        PDFName.of("FontDescriptor"),
        PDFDict,
      );
      if (
        !descriptor ||
        !["FontFile", "FontFile2", "FontFile3"].some((key) =>
          descriptor.has(PDFName.of(key)),
        )
      )
        throw new Error(t("PDF 使用了未嵌入的字体。") + " " + (subtype ?? ""));
    }
    const alternate = (name: string, value: string) =>
      value
        ? `<dc:${name}><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(value)}</rdf:li></rdf:Alt></dc:${name}>`
        : "";
    const list = (name: string, kind: "Bag" | "Seq", values: string[]) =>
      values.length
        ? `<dc:${name}><rdf:${kind}>${values.map((value) => `<rdf:li>${escapeXml(value)}</rdf:li>`).join("")}</rdf:${kind}></dc:${name}>`
        : "";
    const dc =
      alternate("title", metadata.title) +
      alternate("description", metadata.description) +
      alternate("rights", metadata.rights) +
      list("creator", "Seq", v2.creators) +
      list("language", "Bag", metadata.language ? [metadata.language] : []) +
      list("publisher", "Bag", metadata.publisher ? [metadata.publisher] : []) +
      (metadata.identifier
        ? `<dc:identifier>${escapeXml(metadata.identifier)}</dc:identifier>`
        : "");
    const xml = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">${dc}</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
    const stream = context.stream(Buffer.from(xml), {
      Type: "Metadata",
      Subtype: "XML",
    });
    document.catalog.set(PDFName.of("Metadata"), context.register(stream));
    const info = context.lookupMaybe(context.trailerInfo.Info, PDFDict);
    for (const field of ["Title", "Author", "Subject"])
      info?.delete(PDFName.of(field));
    document.catalog.delete(PDFName.of("Lang"));
  }
  if (metadata.title || !v2) document.setTitle(metadata.title);
  if (metadata.author || !v2) document.setAuthor(metadata.author);
  if (metadata.description || !v2) document.setSubject(metadata.description);
  if (metadata.language || !v2) document.setLanguage(metadata.language);
  document.setCreator("Mardikor publication renderer 1");
  document.setProducer(pdf.engine || "Mardikor");
  document.setCreationDate(new Date(metadata.modified));
  document.setModificationDate(new Date(metadata.modified));
  const id = PDFHexString.of(details.fingerprint.slice(0, 32));
  document.context.trailerInfo.ID = document.context.obj([id, id]);
  return {
    bytes: Buffer.from(
      await document.save({ useObjectStreams: true, addDefaultPage: false }),
    ),
    pages,
  };
}

const { work, locale } = deserialize(workerData) as {
  work: PublicationWork;
  locale: AppLocale;
};
setAppLocale(locale);
void run(work).then(
  (value) => parentPort!.postMessage(serialize(value)),
  (error) => {
    throw error;
  },
).finally(() => {
  if (work.kind === "prepare") work.access?.key.fill(0);
});
