import { appLocale, t } from "../shared/i18n";
import { app, BrowserWindow, nativeImage, session } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { deserialize, serialize } from "node:v8";
import type { AppState } from "./state";
import { publicationFontFamily, publicationHtml } from "./publication-render";
import {
  emojiFontFile,
  type PreparedPublication,
  type PublicationRuntime,
} from "./publication";
import { publicationRasterSize } from "./media";
import type { PublicationWork } from "./publication-worker";
import type { PublicationStage } from "../shared/publication";

const publicationTimeout = 300_000;
function runWorker<T>(work: PublicationWork): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "publication-worker.cjs"), {
      workerData: serialize({ work, locale: appLocale() }),
    });
    const timer = setTimeout(() => {
      reject(new Error(t("后台出版任务超过 5 分钟，已终止。")));
      void worker.terminate();
    }, publicationTimeout);
    worker.once("message", (bytes: Uint8Array) => {
      clearTimeout(timer);
      try {
        resolve(deserialize(bytes) as T);
      } catch (error) {
        reject(error);
      }
    });
    worker.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(t("出版任务意外结束：") + code));
    });
  });
}

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
        data: Buffer.from(prepared.renderedHtml ?? publicationHtml(prepared)),
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
  if (
    prepared.format === "pdf" &&
    prepared.chapters.some(({ hasMath }) => hasMath)
  ) {
    const math = path.join(app.getAppPath(), "node_modules", "katex", "dist");
    resources.set("/math/katex.min.css", {
      data: fs.readFileSync(path.join(math, "katex.min.css")),
      type: "text/css",
    });
    const fonts = path.join(math, "fonts");
    for (const name of fs.readdirSync(fonts))
      if (name.endsWith(".woff2"))
        resources.set("/math/fonts/" + name, {
          data: fs.readFileSync(path.join(fonts, name)),
          type: "font/woff2",
        });
  }
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
          const bodyFonts = await document.fonts.load('16px PublicationFont');
          await document.fonts.ready;
          if (!bodyFonts.length || [...document.fonts].some(font=>font.status === 'error')) throw new Error(${JSON.stringify(t("出版字体无法解码或加载"))});
          if (document.querySelector('.katex-html') && ![...document.fonts].some(font=>font.family.startsWith('KaTeX_') && font.status === 'loaded')) throw new Error(${JSON.stringify(t("公式字体未加载"))});
          await Promise.all([...document.images].map(async image=>{await image.decode();if(!image.naturalWidth || image.naturalWidth*image.naturalHeight>40000000)throw new Error(${JSON.stringify(t("图片无法解码或超过四千万像素"))});}));
          const errors=[];
          if(${prepared.format === "pdf"}){
            const context=document.createElement('canvas').getContext('2d');context.font='${pdf.furniture_size}px ${publicationFontFamily(prepared)}';
            for(const text of ${JSON.stringify(samples)})if(context.measureText(text).width>${prepared.width - prepared.configuration.layout.margin_left - prepared.configuration.layout.margin_right})errors.push(${JSON.stringify(t("页眉或页脚过长，请缩短文字或调整字号"))});
          }
          for(const unit of document.querySelectorAll('.unit')){
            if(${prepared.format === "pdf" ? prepared.snapshot.project.mode === "02" : prepared.configuration.publication.epub.layout === "pre-paginated"} && (unit.scrollHeight>unit.clientHeight+2 || unit.scrollWidth>unit.clientWidth+2)) {
              const labels = ${JSON.stringify({ 封面: t("封面"), 目录: t("目录") })};
              errors.push(${JSON.stringify(t("文稿 {0} 超出固定页面，请调整页高、字号或拆分文稿"))}.replace("{0}", () => labels[unit.dataset.unit] ?? unit.dataset.unit));
            }
          }
          for(const element of document.querySelectorAll('pre,table,.katex-block')) if(element.scrollWidth>element.clientWidth+2) errors.push(${JSON.stringify(t("代码、表格或公式超出正文宽度"))});
          return errors;
        })()`);
        if ((errors as string[]).length)
          throw new Error((errors as string[]).join(t("；")));
        return action(window);
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(t("出版渲染超过 5 分钟，已终止，未发布文件。"))),
          publicationTimeout,
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
async function renderPdf(
  prepared: PreparedPublication,
  progress?: (stage: PublicationStage) => void,
) {
  return withRenderer(prepared, async (window) => {
    const { pdf } = prepared.configuration.publication;
    const options: Electron.PrintToPDFOptions = {
      printBackground: pdf.print_background,
      preferCSSPageSize: true,
      scale: pdf.scale,
      displayHeaderFooter: false,
      generateTaggedPDF: pdf.tagged,
      generateDocumentOutline: pdf.outline,
    };
    let raw = await window.webContents.printToPDF(options);
    if (pdf.include_toc) progress?.("pdf-toc");
    const complete =
      pdf.include_toc || pdf.page_ranges
        ? await runWorker<{ labels: Record<string, number>; count: number }>({
            kind: "pdf-pages",
            bytes: raw,
            first: pdf.first_page_number,
          })
        : undefined;
    if (pdf.include_toc && complete) {
      const { labels } = complete;
      await window.webContents.executeJavaScript(`(() => {
        const labels = ${JSON.stringify(labels)};
        for (const node of document.querySelectorAll(".toc-page")) {
          const page = labels[node.dataset.destination];
          if (typeof page !== "number") throw new Error(${JSON.stringify(t("无法确定 PDF 目录页码。"))});
          node.textContent = String(page);
        }
      })()`);
    }
    if (pdf.page_ranges && complete) {
      const maximum = Math.max(
        ...pdf.page_ranges
          .split(",")
          .flatMap((group) => group.trim().split("-").map(Number)),
      );
      if (maximum > complete.count)
        throw new Error(
          t("页码范围超过实际总页数 ") + complete.count + t("，未导出。"),
        );
    }
    if (pdf.include_toc || pdf.page_ranges) {
      progress?.("print-pdf");
      raw = await window.webContents.printToPDF({
        ...options,
        ...(pdf.page_ranges ? { pageRanges: pdf.page_ranges } : {}),
      });
    }
    progress?.("finalize-pdf");
    return runWorker<{ bytes: Buffer; pages: number }>({
      kind: "pdf-finish",
      bytes: raw,
      details: {
        configuration: prepared.configuration,
        font: prepared.font,
        fontText: prepared.fontText,
        fingerprint: prepared.fingerprint,
        headings: prepared.chapters.flatMap((chapter) =>
          chapter.headings.map(({ title }) => title),
        ),
      },
    });
  });
}
export function publicationRuntime(
  state: AppState,
  outputRevision: (file: string) => string | null,
  progress?: (stage: PublicationStage) => void,
): PublicationRuntime {
  const assets = path.join(app.getAppPath(), "assets/export");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(assets, "renderer.json"), "utf8"),
  );
  if (manifest.version !== 1 || !/^[0-9a-f]{64}$/.test(manifest.sha256))
    throw new Error(t("出版渲染器版本清单损坏，请重新安装应用。"));
  const engine = `mardikor-pdf-1/${manifest.sha256}/electron-${process.versions.electron}/chromium-${process.versions.chrome}/${process.platform}-${process.arch}`;
  return {
    outputRevision,
    engine,
    progress,
    prepare: (file, format) =>
      runWorker<PreparedPublication>({
        kind: "prepare",
        file,
        format,
        engine,
        assetDirectory: assets,
        configuration: state.publication(file),
      }),
    assetDirectory: assets,
    localConfiguration: (file, value) => state.publication(file, value),
    verifyImages: (images) => {
      for (const image of images) {
        try {
          publicationRasterSize(image.data);
          const decoded = nativeImage.createFromBuffer(image.data),
            size = decoded.getSize();
          if (decoded.isEmpty() || size.width * size.height > 40000000)
            throw new Error(t("无法解码或超过四千万像素。"));
        } catch (error) {
          throw new Error(image.path + t("：") + String(error));
        }
      }
    },
    verifyLayout: (prepared) => withRenderer(prepared, async () => {}),
    pdf: (prepared) => renderPdf(prepared, progress),
    epub: (prepared) =>
      runWorker<Buffer>({
        kind: "epub",
        prepared: { ...prepared, renderedHtml: undefined },
      }),
  };
}
