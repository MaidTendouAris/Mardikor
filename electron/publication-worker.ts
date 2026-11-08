import { parentPort, workerData } from "node:worker_threads";
import { deserialize, serialize } from "node:v8";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
} from "pdf-lib";
import type {
  PublicationConfiguration,
  PublicationFormat,
} from "../shared/publication";
import { preparePublication, type PreparedPublication } from "./publication";
import { publicationHtml } from "./publication-render";
import { publicationRasterSize } from "./media";
import { pdfCjkAliases, restorePdfSourceCharacters } from "./pdf-text";
import { buildEpub } from "./epub";

type PdfDetails = Pick<
  PreparedPublication,
  "configuration" | "font" | "fontText" | "fingerprint"
> & { headings: string[] };
export type PublicationWork =
  | {
      kind: "prepare";
      file: string;
      format: PublicationFormat;
      engine: string;
      assetDirectory: string;
      configuration: PublicationConfiguration | null;
    }
  | { kind: "pdf-pages"; bytes: Buffer; first: number }
  | { kind: "pdf-finish"; bytes: Buffer; details: PdfDetails }
  | { kind: "epub"; prepared: PreparedPublication };

async function run(work: PublicationWork) {
  if (work.kind === "prepare") {
    const prepared = preparePublication(work.file, work.format, {
      engine: work.engine,
      assetDirectory: work.assetDirectory,
      localConfiguration: () => work.configuration,
      verifyImages: (images) => {
        for (const image of images) {
          try {
            publicationRasterSize(image.data);
          } catch (error) {
            throw new Error(image.path + "：" + String(error));
          }
        }
      },
    });
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
  const { metadata, pdf } = details.configuration.publication;
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
  document.setTitle(metadata.title);
  document.setAuthor(metadata.author);
  document.setSubject(metadata.description);
  document.setLanguage(metadata.language);
  document.setCreator("Mardikor publication renderer 1");
  document.setProducer(pdf.engine);
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

void run(deserialize(workerData) as PublicationWork).then(
  (value) => parentPort!.postMessage(serialize(value)),
  (error) => {
    throw error;
  },
);
