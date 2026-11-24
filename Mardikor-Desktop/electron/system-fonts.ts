import type { WebContents } from "electron";
import { types } from "node:util";
import { BUFFERED_ENTRY_LIMIT } from "./archive-io";
import { t } from "../shared/i18n";
import { validSystemFontName, type SystemFont } from "../shared/fonts";

export async function listSystemFonts(
  contents: WebContents,
): Promise<SystemFont[]> {
  const fonts = await contents.mainFrame.executeJavaScript(
    `(async () => {
    if (!window.queryLocalFonts) return [];
    return (await window.queryLocalFonts()).map(({ postscriptName, fullName, family }) => ({ postscriptName, fullName, family }));
  })()`,
    true,
  );
  return Array.isArray(fonts)
    ? fonts.filter((font) => validSystemFontName(font.postscriptName))
    : [];
}

export async function readSystemFont(
  contents: WebContents,
  name: string,
): Promise<Buffer | undefined> {
  if (!validSystemFontName(name)) return;
  let bytes: unknown;
  try {
    bytes = await contents.mainFrame.executeJavaScript(
      `(async () => {
      const name = ${JSON.stringify(name)};
      if (!window.queryLocalFonts) return null;
      const fonts = await window.queryLocalFonts({ postscriptNames: [name] });
      const font = fonts.find((item) => item.postscriptName === name);
      if (!font) return null;
      const blob = await font.blob();
      if (blob.size > ${BUFFERED_ENTRY_LIMIT}) return null;
      return blob.arrayBuffer();
    })()`,
      true,
    );
  } catch {
    throw new Error(t("无法读取系统字体 {0}。", name));
  }
  if (types.isArrayBuffer(bytes) && bytes.byteLength <= BUFFERED_ENTRY_LIMIT)
    return Buffer.from(bytes);
}
