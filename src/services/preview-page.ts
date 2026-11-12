import type { renderPreview } from "./preview";
import { headingOffsetAtLine, type DocumentPages } from "./document-pages";

export type PreviewArgs = Parameters<typeof renderPreview>;

export function previewPageArgs(
  args: PreviewArgs,
  layout: DocumentPages,
  index: number,
  headings = layout.headings ?? [],
): PreviewArgs {
  const [
    text,
    settings,
    position,
    mode,
    prefix,
    path,
    standalone,
    reserved,
    ,
    headingFragments,
    mapSource,
  ] = args;
  const page = layout.pages[index];
  const headingOffset = headingOffsetAtLine(headings, page.line);
  const prior = headings.slice(0, headingOffset);
  const priorHeadingLevels =
    mode === "01" && settings?.mode.book.chapter_numbering
      ? prior.map(({ level }) => level)
      : settings?.preview.show_title === false &&
          prior.some(({ level }) => level === 1)
        ? [1]
        : [];
  return [
    (page.tableHeader ?? "") +
      text.slice(page.start, layout.pages[index + 1]?.start),
    settings,
    position,
    mode,
    prefix,
    path,
    standalone,
    reserved,
    {
      headingOffset,
      priorHeadingLevels,
      continuedPage: index > 0,
      pageNumber: index + 1,
      literal: page.literal,
      references: layout.references,
      notes: layout.notes,
    },
    headingFragments,
    mapSource,
  ];
}
