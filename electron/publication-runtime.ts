import { app, BrowserWindow, nativeImage, session } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
} from "pdf-lib";
import type { AppState } from "./state";
import { publicationFontFamily, publicationHtml } from "./publication-render";
import { buildEpub } from "./epub";
import {
  emojiFontFile,
  type PreparedPublication,
  type PublicationRuntime,
} from "./publication";
import { pdfCjkAliases, restorePdfSourceCharacters } from "./pdf-text";
import { publicationRasterSize } from "./media";

const scheme = "mardikor-export";
async function withRenderer<T>(
  prepared: PreparedPublication,
  action: (window: BrowserWindow) => Promise<T>,
) {
  const partition = "publication-" + randomUUID(),
    ses = session.fromPartition(partition);
  const resources = new Map<string, { data: Buffer; type: string }>([
    [
      "/index.html",
      {
        data: Buffer.from(publicationHtml(prepared)),
        type: "text/html; charset=utf-8",
      },
    ],
    ["/" + prepared.fontFile, { data: prepared.font, type: prepared.fontType }],
    ...[...prepared.assets].map(
      ([name, asset]) =>
        ["/" + name, { data: asset.data, type: asset.mediaType }] as const,
    ),
  ]);
  if (prepared.emojiFont)
    resources.set("/assets/" + emojiFontFile, {
      data: prepared.emojiFont.bytes,
      type: "font/ttf",
    });
  ses.protocol.handle(scheme, (request) => {
    const url = new URL(request.url),
      entry =
        url.hostname === "snapshot" ? resources.get(url.pathname) : undefined;
    return entry
      ? new Response(new Uint8Array(entry.data), {
          headers: {
            "Content-Type": entry.type,
            "X-Content-Type-Options": "nosniff",
          },
        })
      : new Response("Not found", { status: 404 });
  });
  ses.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !details.url.startsWith(scheme + "://snapshot/") }),
  );
  ses.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  const window = new BrowserWindow({
    show: false,
    width: Math.max(300, Math.ceil(prepared.width)),
    height: Math.max(300, Math.ceil(prepared.height)),
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        await window.loadURL(scheme + "://snapshot/index.html");
        const { pdf, metadata } = prepared.configuration.publication;
        const samples = [
          pdf.header,
          pdf.footer || (pdf.page_numbers ? "{page} / {pages}" : ""),
        ].map((text) =>
          text
            .replace(/\{title\}/g, metadata.title)
            .replace(/\{author\}/g, metadata.author)
            .replace(/\{(?:page|pages)\}/g, "100000"),
        );
        const errors = await window.webContents.executeJavaScript(`(async()=>{
          ${prepared.emojiFont ? `await document.fonts.load('16px PublicationEmoji', ${JSON.stringify(prepared.emojiFont.text)});` : ""}
          await document.fonts.ready;
          if (![...document.fonts].length || [...document.fonts].some(font=>font.status !== 'loaded')) throw new Error('工程字体无法解码或加载');
          await Promise.all([...document.images].map(async image=>{await image.decode();if(!image.naturalWidth || image.naturalWidth*image.naturalHeight>40000000)throw new Error('图片无法解码或超过四千万像素');}));
          const errors=[];
          if(${prepared.format === "pdf"}){
            const context=document.createElement('canvas').getContext('2d');context.font='${pdf.furniture_size}px ${publicationFontFamily(prepared)}';
            for(const text of ${JSON.stringify(samples)})if(context.measureText(text).width>${prepared.width - prepared.configuration.layout.margin_left - prepared.configuration.layout.margin_right})errors.push('页眉或页脚过长，请缩短文字或调整字号');
          }
          for(const unit of document.querySelectorAll('.unit')){
            if(${prepared.format === "pdf" ? prepared.snapshot.project.mode === "02" : prepared.configuration.publication.epub.layout === "pre-paginated"} && (unit.scrollHeight>unit.clientHeight+2 || unit.scrollWidth>unit.clientWidth+2)) errors.push('文稿 '+unit.dataset.unit+' 超出固定页面，请调整页高、字号或拆分文稿');
          }
          for(const element of document.querySelectorAll('pre,table')) if(element.scrollWidth>element.clientWidth+2) errors.push('代码或表格超出正文宽度');
          return errors;
        })()`);
        if ((errors as string[]).length)
          throw new Error((errors as string[]).join("；"));
        return action(window);
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error("出版渲染超过 60 秒支持范围，已终止，未发布文件。"),
            ),
          60000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (!window.isDestroyed()) window.destroy();
    ses.webRequest.onBeforeRequest(null);
    ses.protocol.unhandle(scheme);
    await ses.clearStorageData();
  }
}
async function renderPdf(prepared: PreparedPublication) {
  return withRenderer(prepared, async (window) => {
    const { pdf, metadata } = prepared.configuration.publication;
    const options: Electron.PrintToPDFOptions = {
      printBackground: pdf.print_background,
      preferCSSPageSize: true,
      scale: pdf.scale,
      displayHeaderFooter: false,
      generateTaggedPDF: pdf.tagged,
      generateDocumentOutline: pdf.outline,
    };
    let raw = await window.webContents.printToPDF(options);
    if (pdf.page_ranges) {
      const complete = await PDFDocument.load(raw, { updateMetadata: false });
      const maximum = Math.max(
        ...pdf.page_ranges
          .split(",")
          .flatMap((group) => group.trim().split("-").map(Number)),
      );
      if (maximum > complete.getPageCount())
        throw new Error(
          "页码范围超过实际总页数 " + complete.getPageCount() + "，未导出。",
        );
      raw = await window.webContents.printToPDF({
        ...options,
        pageRanges: pdf.page_ranges,
      });
    }
    const document = await PDFDocument.load(raw, { updateMetadata: false });
    // Chromium can repeat the complete heading in a tagged PDF bookmark.
    // Only repair titles that exactly match two copies of a rendered heading.
    const headings = new Set(
      prepared.chapters.flatMap((chapter) =>
        chapter.headings.map((heading) => heading.title),
      ),
    );
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
      const title =
        text && !headings.has(text) ? repeated.get(text) : undefined;
      if (title) bookmark.set(titleKey, PDFHexString.fromText(title));
      stack.push(
        bookmark.lookupMaybe(nextKey, PDFDict),
        bookmark.lookupMaybe(firstKey, PDFDict),
      );
    }
    restorePdfSourceCharacters(
      document,
      pdfCjkAliases(prepared.font, prepared.fontText),
    );
    const pages = document.getPages();
    document.setTitle(metadata.title);
    document.setAuthor(metadata.author);
    document.setSubject(metadata.description);
    document.setLanguage(metadata.language);
    document.setCreator("Mardikor publication renderer 1");
    document.setProducer(prepared.configuration.publication.pdf.engine);
    document.setCreationDate(new Date(metadata.modified));
    document.setModificationDate(new Date(metadata.modified));
    const id = PDFHexString.of(prepared.fingerprint.slice(0, 32));
    document.context.trailerInfo.ID = document.context.obj([id, id]);
    return {
      bytes: Buffer.from(
        await document.save({ useObjectStreams: true, addDefaultPage: false }),
      ),
      pages: pages.length,
    };
  });
}
export function publicationRuntime(
  state: AppState,
  outputRevision: (file: string) => string | null,
): PublicationRuntime {
  const assets = path.join(app.getAppPath(), "assets/export");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(assets, "renderer.json"), "utf8"),
  );
  if (manifest.version !== 1 || !/^[0-9a-f]{64}$/.test(manifest.sha256))
    throw new Error("出版渲染器版本清单损坏，请重新安装应用。");
  return {
    outputRevision,
    engine: `mardikor-pdf-1/${manifest.sha256}/electron-${process.versions.electron}/chromium-${process.versions.chrome}/${process.platform}-${process.arch}`,
    assetDirectory: assets,
    localConfiguration: (file, value) => state.publication(file, value),
    verifyImages: (images) => {
      for (const image of images) {
        try {
          publicationRasterSize(image.data);
          const decoded = nativeImage.createFromBuffer(image.data),
            size = decoded.getSize();
          if (decoded.isEmpty() || size.width * size.height > 40000000)
            throw new Error("无法解码或超过四千万像素。");
        } catch (error) {
          throw new Error(image.path + "：" + String(error));
        }
      }
    },
    verifyLayout: (prepared) => withRenderer(prepared, async () => {}),
    pdf: renderPdf,
    epub: buildEpub,
  };
}
