import type { MdkSettings } from "./mdk";

export function defaultSettings(): MdkSettings {
  return {
    schema_version: 1,
    appearance: {
      theme: "default",
      font_family: "system",
      font_size: 16,
      line_height: 1.7,
      paragraph_spacing: 0.8,
    },
    colors: {
      text: "#1f2933",
      background: "#ffffff",
      link: "#2563eb",
      quote: "#64748b",
    },
    layout: {
      page_width: 720,
      margin_top: 32,
      margin_bottom: 32,
      margin_left: 32,
      margin_right: 32,
    },
    preview: {
      show_title: true,
      show_toc: true,
      render_containers: true,
      show_word_count: true,
      live_preview: true,
    },
    export: {
      default_target: "mdk",
      validate_before_export: true,
      include_meta: true,
      include_editor_state: false,
      preserve_source_names: true,
      mdk: {
        package_mode: "portable",
        overwrite_existing: false,
        normalize_paths: true,
      },
    },
    mode: {
      book: { toc_depth: 3, split_by_heading: false, chapter_numbering: true },
      comic: {
        reading_direction: "ltr",
        page_fit: "contain",
        spread_mode: "single",
      },
      "00": { label: "default" },
      "01": { label: "book" },
      "02": { label: "comic" },
    },
  };
}
