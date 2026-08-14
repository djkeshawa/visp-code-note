/**
 * Enough of the `vscode` module to run the extension host's file-event handlers under `node:test`.
 *
 * The unit suites otherwise stop at the edge of the API, which is exactly where the rename
 * handlers live: the interesting behaviour is what a `FileWillRenameEvent` carrying two notes at
 * once turns into, and that cannot be asserted by checking that a subscription was registered.
 * This intercepts `require("vscode")` so the real modules can be loaded unmodified and driven
 * with real event payloads.
 *
 * It is deliberately literal — URIs round-trip through the same percent-encoding VS Code uses,
 * because prefix-matching a folder against the notes inside it depends on that — and deliberately
 * small. Anything a test does not reach is not here.
 */

type Listener<T> = (value: T) => unknown;

export class StubDisposable {
  constructor(private readonly onDispose: () => void) {}

  dispose(): void {
    this.onDispose();
  }

  static from(...items: readonly { dispose(): unknown }[]): StubDisposable {
    return new StubDisposable(() => {
      for (const item of items) item.dispose();
    });
  }
}

export interface StubEmitter<T> {
  readonly event: (listener: Listener<T>) => StubDisposable;
  fire(value: T): void;
}

function emitter<T>(): StubEmitter<T> {
  const listeners = new Set<Listener<T>>();
  return {
    event: (listener) => {
      listeners.add(listener);
      return new StubDisposable(() => listeners.delete(listener));
    },
    fire: (value) => {
      for (const listener of [...listeners]) listener(value);
    },
  };
}

function encodePath(path: string): string {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

export class StubUri {
  readonly query = "";
  readonly fragment = "";

  private constructor(
    readonly scheme: string,
    readonly authority: string,
    readonly path: string,
  ) {}

  static parse(value: string): StubUri {
    const match = /^([A-Za-z][A-Za-z\d+.-]*):\/\/([^/?#]*)([^?#]*)/.exec(value);
    if (match === null) throw new Error(`The vscode stub cannot parse "${value}" as a URI.`);
    const path = (match[3] ?? "").split("/").map((segment) => decodeURIComponent(segment)).join("/");
    return new StubUri(match[1]!, match[2]!, path);
  }

  static file(path: string): StubUri {
    return new StubUri("file", "", path.startsWith("/") ? path : `/${path}`);
  }

  get fsPath(): string {
    return this.path;
  }

  with(change: { readonly path?: string }): StubUri {
    return new StubUri(this.scheme, this.authority, change.path ?? this.path);
  }

  toString(): string {
    return `${this.scheme}://${this.authority}${encodePath(this.path)}`;
  }

  toJSON(): unknown {
    return { scheme: this.scheme, authority: this.authority, path: this.path };
  }
}

export class StubPosition {
  constructor(readonly line: number, readonly character: number) {}
}

export class StubRange {
  constructor(readonly start: StubPosition, readonly end: StubPosition) {}
}

export class StubTextDocument {
  isDirty = false;

  constructor(readonly uri: StubUri, private text: string) {}

  getText(): string {
    return this.text;
  }

  setText(text: string): void {
    this.text = text;
  }

  positionAt(offset: number): StubPosition {
    const clamped = Math.min(Math.max(offset, 0), this.text.length);
    const before = this.text.slice(0, clamped);
    const lastBreak = before.lastIndexOf("\n");
    const line = before.length === 0 ? 0 : before.split("\n").length - 1;
    return new StubPosition(line, clamped - lastBreak - 1);
  }
}

export interface StubTextEdit {
  readonly range: StubRange;
  readonly newText: string;
}

export class StubWorkspaceEdit {
  private readonly edits = new Map<string, StubTextEdit[]>();
  private readonly uris = new Map<string, StubUri>();

  replace(uri: StubUri, range: StubRange, newText: string): void {
    const key = uri.toString();
    this.uris.set(key, uri);
    this.edits.set(key, [...(this.edits.get(key) ?? []), { range, newText }]);
  }

  get size(): number {
    return this.edits.size;
  }

  entries(): readonly (readonly [StubUri, readonly StubTextEdit[]])[] {
    return [...this.edits].map(([key, items]) => [this.uris.get(key)!, items] as const);
  }
}

export interface StubWorkspaceFolder {
  readonly uri: StubUri;
  readonly name: string;
  readonly index: number;
}

export interface FileRenamePayload {
  readonly files: readonly { readonly oldUri: StubUri; readonly newUri: StubUri }[];
}

export interface WillRenamePayload extends FileRenamePayload {
  waitUntil(thenable: Promise<StubWorkspaceEdit>): void;
}

export interface VscodeStub {
  /** Absolute file path to note text, as the fake file system. */
  readonly files: Map<string, string>;
  /** Documents VS Code has open, keyed by `Uri.toString()`. */
  readonly documents: Map<string, StubTextDocument>;
  folders: StubWorkspaceFolder[];
  excludes: readonly string[];
  readonly warnings: string[];
  readonly willRenameFiles: StubEmitter<WillRenamePayload>;
  readonly didRenameFiles: StubEmitter<FileRenamePayload>;
  readonly didCreateFiles: StubEmitter<{ readonly files: readonly StubUri[] }>;
  readonly didDeleteFiles: StubEmitter<{ readonly files: readonly StubUri[] }>;
  reset(): void;
}

const willRenameFiles = emitter<WillRenamePayload>();
const didRenameFiles = emitter<FileRenamePayload>();
const didCreateFiles = emitter<{ readonly files: readonly StubUri[] }>();
const didDeleteFiles = emitter<{ readonly files: readonly StubUri[] }>();
const changeConfiguration = emitter<unknown>();
const changeWorkspaceFolders = emitter<unknown>();
const changeTextDocument = emitter<unknown>();
const closeTextDocument = emitter<unknown>();

const state: VscodeStub = {
  files: new Map<string, string>(),
  documents: new Map<string, StubTextDocument>(),
  folders: [{ uri: StubUri.file("/vault"), name: "vault", index: 0 }],
  excludes: ["**/node_modules/**"],
  warnings: [],
  willRenameFiles,
  didRenameFiles,
  didCreateFiles,
  didDeleteFiles,
  reset(): void {
    state.files.clear();
    state.documents.clear();
    state.folders = [{ uri: StubUri.file("/vault"), name: "vault", index: 0 }];
    state.excludes = ["**/node_modules/**"];
    state.warnings.length = 0;
  },
};

const encoder = new TextEncoder();

const api = {
  Uri: StubUri,
  Position: StubPosition,
  Range: StubRange,
  Disposable: StubDisposable,
  WorkspaceEdit: StubWorkspaceEdit,
  EventEmitter: class {
    private readonly inner = emitter<unknown>();
    readonly event = this.inner.event;
    fire(value: unknown): void {
      this.inner.fire(value);
    }
    dispose(): void {}
  },
  window: {
    showWarningMessage(message: string): Promise<undefined> {
      state.warnings.push(message);
      return Promise.resolve(undefined);
    },
  },
  workspace: {
    get workspaceFolders(): readonly StubWorkspaceFolder[] {
      return state.folders;
    },
    get textDocuments(): readonly StubTextDocument[] {
      return [...state.documents.values()];
    },
    createFileSystemWatcher(): unknown {
      return {
        onDidCreate: emitter<StubUri>().event,
        onDidChange: emitter<StubUri>().event,
        onDidDelete: emitter<StubUri>().event,
        dispose(): void {},
      };
    },
    getWorkspaceFolder(uri: StubUri): StubWorkspaceFolder | undefined {
      return state.folders.find(
        (folder) => uri.path === folder.uri.path || uri.path.startsWith(`${folder.uri.path}/`),
      );
    },
    getConfiguration(): { get(key: string, fallback?: unknown): unknown } {
      return {
        get(key: string, fallback?: unknown): unknown {
          if (key === "exclude") return state.excludes;
          if (key === "maxNoteSizeKB") return 5120;
          return fallback;
        },
      };
    },
    asRelativePath(uri: StubUri, includeRoot?: boolean): string {
      const folder = api.workspace.getWorkspaceFolder(uri);
      if (!folder) return uri.path;
      const relative = uri.path.slice(folder.uri.path.length + 1);
      return includeRoot === true ? `${folder.name}/${relative}` : relative;
    },
    openTextDocument(uri: StubUri): Promise<StubTextDocument> {
      const open = state.documents.get(uri.toString());
      if (open) return Promise.resolve(open);
      const content = state.files.get(uri.path);
      if (content === undefined) {
        return Promise.reject(new Error(`The vscode stub has no file at ${uri.path}.`));
      }
      const document = new StubTextDocument(uri, content);
      state.documents.set(uri.toString(), document);
      return Promise.resolve(document);
    },
    fs: {
      stat(uri: StubUri): Promise<{ size: number; ctime: number; mtime: number }> {
        const content = state.files.get(uri.path);
        if (content === undefined) {
          return Promise.reject(new Error(`The vscode stub has no file at ${uri.path}.`));
        }
        return Promise.resolve({ size: encoder.encode(content).length, ctime: 1, mtime: 1 });
      },
      readFile(uri: StubUri): Promise<Uint8Array> {
        const content = state.files.get(uri.path);
        if (content === undefined) {
          return Promise.reject(new Error(`The vscode stub has no file at ${uri.path}.`));
        }
        return Promise.resolve(encoder.encode(content));
      },
    },
    onWillRenameFiles: willRenameFiles.event,
    onDidRenameFiles: didRenameFiles.event,
    onDidCreateFiles: didCreateFiles.event,
    onDidDeleteFiles: didDeleteFiles.event,
    onDidChangeConfiguration: changeConfiguration.event,
    onDidChangeWorkspaceFolders: changeWorkspaceFolders.event,
    onDidChangeTextDocument: changeTextDocument.event,
    onDidCloseTextDocument: closeTextDocument.event,
  },
};

interface ModuleLoader {
  _load(request: string, parent: unknown, isMain: boolean): unknown;
}

let installed = false;

/** Points `require("vscode")` at the stub. Safe to call more than once. */
export function installVscodeStub(): VscodeStub {
  if (installed) return state;
  installed = true;
  const loader = require("node:module") as ModuleLoader;
  const load = loader._load.bind(loader);
  loader._load = (request: string, parent: unknown, isMain: boolean): unknown =>
    request === "vscode" ? api : load(request, parent, isMain);
  return state;
}
