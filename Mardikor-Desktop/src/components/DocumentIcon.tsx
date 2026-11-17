import defaultIcon from "../../assets/icons/mdk-default.svg";
import bookIcon from "../../assets/icons/mdk-book.svg";
import comicIcon from "../../assets/icons/mdk-comic.svg";
import markdownIcon from "../../assets/icons/markdown.svg";

const icons: Record<string, string> = {
  "00": defaultIcon,
  "01": bookIcon,
  "02": comicIcon,
  markdown: markdownIcon,
};

export function DocumentIcon({
  mode = "00",
  size = 24,
}: {
  mode?: string;
  size?: number;
}) {
  return (
    <img
      className="document-icon"
      src={icons[mode] ?? defaultIcon}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
