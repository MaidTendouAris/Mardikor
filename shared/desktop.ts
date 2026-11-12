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
  ReadingUnit,
  ResourceInsertion,
  ResourceInsertionResult,
} from "./mdk";
import type { NativeDocumentDrop } from "./resources";
import type {
  PublicationConfiguration,
  PublicationFormat,
  PublicationInfo,
  PublicationPlan,
  PublicationResult,
} from "./publication";

export interface MdkCommands {
  publicationInfo: (path: string) => PublicationInfo;
  configurePublication: (
    path: string,
    configuration: PublicationConfiguration,
    revision: string,
    format?: PublicationFormat,
  ) => PublicationInfo;
  planPublication: (
    path: string,
    format: PublicationFormat,
  ) => Promise<PublicationPlan>;
  exportPublication: (
    path: string,
    output: string,
    format: PublicationFormat,
    fingerprint: string,
  ) => Promise<PublicationResult>;
  create: (path: string, mode: string) => MdkProject;
  open: (path: string) => MdkProject;
  readEntry: (path: string, id: string) => EntryContent;
  saveEntry: (path: string, id: string, markdown: string) => EntryContent;
  addEntry: (path: string, filename: string, afterId?: string) => MdkProject;
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
  ) => ResourceInsertionResult;
  readText: (path: string, internalPath: string) => TextFileContent;
  readDocuments: (path: string, internalPaths: string[]) => Pick<TextFileContent, "path" | "content">[];
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
  ) => MdkSummary;
  exportPlan: (path: string) => ExportPlan;
  saveSnapshot: (path: string, snapshot: SaveSnapshot) => MdkProject;
  copyDraft: (path: string, output: string, snapshot: SaveSnapshot) => void;
  readingUnits: (path: string) => ReadingUnit[];
  validate: (path: string) => ValidationReport;
  readMode: (path: string) => string;
  readResource: (path: string, internalPath: string) => string;
  setMode: (path: string, mode: string) => MdkProject;
  checkPackDirectory: (directory: string) => void;
  pack: (directory: string, output: string, mode: string) => MdkSummary;
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
  | "resource"
  | "directory";
export type EditAction =
  "cut" | "copy" | "paste" | "paste-text" | "select-all" | "copy-text";
export interface DesktopApi {
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
  locale(): Promise<import("./i18n").AppLocale>;
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
  revealFile(path: string): Promise<void>;
  renameArchive(name: string, revision: string, mode: string): Promise<string>;
  recovery(
    path: string,
    value?: SaveSnapshot | null,
  ): Promise<SaveSnapshot | null>;
  onDocumentDrop(callback: (drop: NativeDocumentDrop) => void): () => void;
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
