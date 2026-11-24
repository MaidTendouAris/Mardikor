import type {
  EntryContent,
  EntryPositionUpdate,
  MdkProject,
  MdkSettings,
  MdkSummary,
  ResourceFile,
  ResourceKind,
  TextFileContent,
  ValidationReport,
  SaveSnapshot,
  ExportPlan,
  DeliverySelection,
  ReadingUnit,
  ResourceInsertion,
  ResourceInsertionResult,
} from "./mdk";
import type { NativeDocumentDrag, NativeDocumentDrop } from "./resources";
import type { DocumentPosition } from "./document-position";
import type {
  PublicationConfiguration,
  PublicationFormat,
  PublicationInfo,
  PublicationPlan,
  PublicationPresetEdit,
  PublicationResult,
} from "./publication";

export interface MdkCommands {
  publicationInfo: (path: string) => PublicationInfo;
  packFont: (path: string, revision: string) => Promise<{ path: string; revision: string } | null>;
  readFont: (path: string, internalPath: string) => string;
  configurePublication: (
    path: string,
    configuration: PublicationConfiguration,
    revision: string,
    format?: PublicationFormat,
  ) => PublicationInfo | Promise<PublicationInfo>;
  saveMdkPublication: (path: string, edits: PublicationPresetEdit[], revision: string) => {
    ids: (string | undefined)[];
    revision: string;
  };
  planPublication: (
    path: string,
    format: PublicationFormat,
    presetId?: string,
  ) => Promise<PublicationPlan>;
  previewPdf: (path: string, fingerprint: string, presetId?: string) => Promise<void>;
  exportPublication: (
    path: string,
    output: string,
    format: PublicationFormat,
    fingerprint: string,
    presetId?: string,
  ) => Promise<PublicationResult>;
  create: (path: string, mode: string) => MdkProject;
  addPublicationPreset: (
    path: string,
    format: PublicationFormat,
    revision: string,
  ) => { id: string; revision: string };
  open: (path: string) => MdkProject;
  readEntry: (path: string, id: string) => EntryContent;
  saveEntry: (path: string, id: string, markdown: string) => EntryContent;
  addEntry: (path: string, filename: string, afterId?: string) => MdkProject;
  addGroup: (path: string, title: string, parentId?: string) => MdkProject;
  indexFile: (path: string, internalPath: string) => MdkProject;
  deleteEntry: (path: string, id: string) => MdkProject;
  renameEntry: (path: string, id: string, filename: string) => MdkProject;
  reorderEntries: (path: string, updates: EntryPositionUpdate[]) => MdkProject;
  splitEntry: (path: string, id: string) => MdkProject;
  importResource: (
    path: string,
    source: string,
    kind: ResourceKind,
  ) => ResourceFile;
  createResourceFolder: (
    file: string,
    parent: string,
    name: string,
    revision: string,
  ) => MdkProject;
  renameResource: (
    file: string,
    source: string,
    name: string,
    revision: string,
  ) => MdkProject;
  deleteResource: (
    file: string,
    source: string,
    revision: string,
  ) => MdkProject;
  importResourcesTo: (
    file: string,
    folder: string,
    mode: "files" | "folders",
    revision: string,
  ) => Promise<{ project: MdkProject; count: number } | null>;
  extractResources: (
    file: string,
    paths: string[],
    revision: string,
  ) => Promise<{ path: string; count: number } | null>;
  extractProjectFiles: MdkCommands["extractResources"];
  insertResources: (
    path: string,
    token: string,
    insertion: ResourceInsertion,
  ) => ResourceInsertionResult | Promise<ResourceInsertionResult>;
  readText: (path: string, internalPath: string) => TextFileContent;
  readDocuments: (
    path: string,
    internalPaths: string[],
  ) => Pick<TextFileContent, "path" | "content">[];
  saveText: (
    path: string,
    internalPath: string,
    content: string,
  ) => TextFileContent;
  updateSettings: (path: string, settings: MdkSettings) => MdkProject;
  export: (
    path: string,
    output: string,
    confirmedRevision?: string,
    selection?: DeliverySelection,
  ) => MdkSummary;
  exportPlan: (path: string, selection?: DeliverySelection) => ExportPlan;
  saveSnapshot: (path: string, snapshot: SaveSnapshot) => MdkProject;
  copyDraft: (path: string, output: string, snapshot: SaveSnapshot) => void;
  readingUnits: (path: string) => ReadingUnit[];
  validate: (path: string) => ValidationReport;
  readMode: (path: string) => string;
  readResource: (path: string, internalPath: string) => string;
  setMode: (path: string, mode: string) => MdkProject;
  checkPackDirectory: (directory: string) => void;
  pack: (directory: string, output: string) => MdkSummary;
  unpack: (path: string, directory: string) => MdkSummary;
}

export interface RecentProject {
  path: string;
  title: string;
  mode: string;
  updatedAt: string;
}
export const appThemes = ["light", "dark", "warm", "system"] as const;
export type AppTheme = (typeof appThemes)[number];
export type ResolvedAppTheme = Exclude<AppTheme, "system">;

export interface Preferences {
  autosave: boolean;
  autosaveInterval: number;
  directorySyncThreshold: number;
  externalOpenView?: "preview" | "source" | "write";
  autoCheckUpdates?: boolean;
  followOutline?: boolean;
  appTheme?: AppTheme;
  pageLength?: number;
  showPageMarkers?: boolean;
  allowTableHorizontalScroll?: boolean;
  shortcuts?: import("./shortcuts").ShortcutOverrides;
  language?: import("./i18n").LanguagePreference;
}
export const defaultPageLength = 8000;
export const minPageLength = 2000;
export const maxPageLength = 24000;
export type DialogKind =
  | "open-project"
  | "save-project"
  | "save-markdown"
  | "save-pdf"
  | "save-epub"
  | "save-mdke"
  | "resource"
  | "directory";
export type EditAction =
  "cut" | "copy" | "paste" | "paste-text" | "select-all" | "copy-text";
export interface DesktopApi {
  inspectEnvelope(file: string): Promise<import("./envelopes").EnvelopeInfo>;
  envelope(file: string, action: import("./envelopes").EnvelopeAction): Promise<
    import("./envelopes").EnvelopeReport | import("./envelopes").AccessChangeResult | { overlap: true } | undefined
  >;
  lockEnvelope(file: string): Promise<void>;
  cancelEnvelope(): Promise<void>;
  cancelArchive(): Promise<void>;
  onArchiveProgress(callback: (progress: import("./archive-operation").ArchiveProgress | null) => void): () => void;
  convertMarkdown(): Promise<boolean>;
  update(
    action: import("./updates").UpdateAction,
  ): Promise<import("./updates").UpdateStatus>;
  onUpdate(
    callback: (status: import("./updates").UpdateStatus) => void,
  ): () => void;
  onSaveForUpdate(callback: () => Promise<boolean>): () => void;
  edit(action: EditAction, text?: string): Promise<void>;
  pickDocumentResources(): Promise<{ token: string; names: string[] } | null>;
  pasteDocumentImage(
    bytes: Uint8Array,
    mime: string,
  ): Promise<{ token: string; names: string[] }>;
  invoke<K extends keyof MdkCommands>(
    command: K,
    ...args: Parameters<MdkCommands[K]>
  ): Promise<Awaited<ReturnType<MdkCommands[K]>>>;
  dialog(kind: DialogKind, defaultPath?: string): Promise<string | null>;
  recent(): Promise<RecentProject[]>;
  documentPosition(file: string): Promise<DocumentPosition | undefined>;
  trackDocumentPosition(file: string, position: DocumentPosition): void;
  locale(): Promise<import("./i18n").AppLocale>;
  systemFonts(): Promise<import("./fonts").SystemFont[]>;
  preferences(value?: Preferences): Promise<Preferences>;
  readingPreferences(
    change?: import("./reading").ReadingChange,
  ): Promise<import("./reading").ReadingPreferences>;
  onReadingPreferencesChanged(
    callback: (value: import("./reading").ReadingPreferences) => void,
  ): () => void;
  onPreferencesChanged(
    callback: (preferences: Preferences) => void,
  ): () => void;
  window(
    action: "minimize" | "maximize" | "close" | "isMaximized",
  ): Promise<boolean>;
  onOpenProject(
    callback: (path: string, fragment?: string) => void,
  ): () => void;
  setDirty(dirty: boolean): void;
  onWindowMaximized(callback: (maximized: boolean) => void): () => void;
  onSaveBeforeClose(callback: () => Promise<boolean>): () => void;
  openExternal(url: string): Promise<void>;
  openMarkdownLink(href: string): Promise<void>;
  openMedia(project: string, path: string, kind: import("./media-viewer").AttachmentViewerKind): Promise<void>;
  preparePlayback(project: string, path: string, kind: import("./media-viewer").PlaybackKind): Promise<string>;
  releasePlayback(url: string): Promise<void>;
  revealFile(path: string): Promise<void>;
  renameArchive(name: string, revision: string, mode: string): Promise<string>;
  recovery(
    path: string,
    value?: SaveSnapshot | null,
  ): Promise<SaveSnapshot | null>;
  onDocumentDrop(callback: (drop: NativeDocumentDrop) => void): () => void;
  onDocumentDrag(callback: (point: NativeDocumentDrag | null) => void): () => void;
  onProjectChanged(
    callback: (file: string, revision: string | null) => void,
  ): () => void;
  onPublicationProgress(
    callback: (
      file: string,
      stage: import("./publication").PublicationStage,
    ) => void,
  ): () => void;
}

declare global {
  interface Window {
    mardikor?: DesktopApi;
  }
}
