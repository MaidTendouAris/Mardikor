export type MdkMode = "00" | "01" | "02" | string;
export type ResourceKind = "image" | "video" | "audio" | "font" | "other";
export type Severity = "error" | "warning" | "info";

export interface MdkEntry {
  id: string;
  path: string;
  position: string;
  extensions?: Record<string, unknown>;
}

export function entryDisplayName(entry: MdkEntry): string | undefined {
  const extension = entry.extensions?.mardikor;
  if (extension && typeof extension === "object" && "display_name" in extension &&
    typeof extension.display_name === "string" && extension.display_name.trim())
    return extension.display_name;
}

export interface MdkContents {
  schema_version: number;
  entries: MdkEntry[];
}

export interface MdkSettings {
  extensions?: Record<string, unknown>;
  schema_version: number;
  appearance: {
    theme: string;
    font_family: string;
    font_size: number;
    line_height: number;
    paragraph_spacing: number;
  };
  colors: {
    text: string;
    background: string;
    link: string;
    quote: string;
  };
  layout: {
    page_width: number;
    margin_top: number;
    margin_bottom: number;
    margin_left: number;
    margin_right: number;
  };
  preview: {
    show_title: boolean;
    show_toc: boolean;
    render_containers: boolean;
    show_word_count: boolean;
    live_preview: boolean;
  };
  export: {
    default_target: string;
    validate_before_export: boolean;
    include_meta: boolean;
    include_editor_state: boolean;
    preserve_source_names: boolean;
    mdk: {
      package_mode: string;
      overwrite_existing: boolean;
      normalize_paths: boolean;
    };
  };
  mode: {
    book: {
      toc_depth: number;
      split_by_heading: boolean;
      chapter_numbering: boolean;
    };
    comic: { reading_direction: string; page_fit: string; spread_mode: string };
    [key: string]: unknown;
  };
}

export interface ProjectFile {
  path: string;
  kind: "control" | "markdown" | "resource" | "meta" | "other" | string;
  bytes: number;
  is_text?: boolean;
}

export interface MdkProject {
  format?: "mdk" | "markdown";
  encoding?: "UTF-8" | "GB18030";
  revision: string;
  mode: MdkMode;
  contents: MdkContents;
  settings: MdkSettings;
  files: ProjectFile[];
  issues: ValidationIssue[];
  settings_readonly: boolean;
  readonly: boolean;
}

export interface SaveSnapshot {
  revision: string;
  text?: { path: string; content: string };
  texts?: { path: string; content: string }[];
  positions?: EntryPositionUpdate[];
  settings?: MdkSettings;
}
export interface ResourceInsertion extends SaveSnapshot {
  text: { path: string; content: string };
  marker: string;
}
export interface ResourceInsertionResult {
  project: MdkProject;
  content: string;
  resources: ResourceFile[];
}
export interface ReadingUnit extends MdkEntry {
  markdown: string | null;
}
export interface ExportPlan {
  revision: string;
  report: ValidationReport;
  included_meta: string[];
  excluded_meta: string[];
  confirmation_required: boolean;
  preflight_report: boolean;
}

export interface EntryContent {
  entry_id: string;
  path: string;
  markdown: string;
}

export interface TextFileContent {
  path: string;
  content: string;
}

export interface EntryPositionUpdate {
  id: string;
  position: string;
}

export interface ResourceFile {
  path: string;
  kind: ResourceKind;
  bytes: number;
}

export interface MdkSummary {
  mode: string;
  entries: number;
  files: number;
  resources: number;
}

export interface ValidationIssue {
  severity: Severity;
  code: string;
  message: string;
  path?: string;
}

export interface ValidationReport {
  valid: boolean;
  mode?: string;
  issues: ValidationIssue[];
  summary?: MdkSummary;
}
