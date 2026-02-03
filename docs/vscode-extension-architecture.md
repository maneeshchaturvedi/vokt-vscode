# Vokt VS Code Extension - Architecture & Implementation

## Overview

The Vokt VS Code extension provides real-time behavioral drift detection directly in the editor. It communicates with the Vokt CLI via the Language Server Protocol (LSP), enabling developers to see inline diagnostics when code changes conflict with behavioral specifications.

### Key Features

- **Smart Change Filtering**: Only sends significant changes to the LSP server (ignores comments, whitespace, formatting)
- **Scope-Aware Detection**: Tracks which function/method/class was edited and includes this context in drift checks
- **Buffered Edits**: Batches rapid edits with a 400ms idle timeout to prevent LSP chatter
- **Rich Diagnostics**: Shows what behavior changed with "Spec says" vs "Change says" messages
- **Status Bar Integration**: Shows connection state and spec coverage
- **Specs Explorer**: Tree view of all specs in the project

---

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                         VS Code Editor                               │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Vokt Extension (TypeScript)                                │    │
│  │                                                              │    │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐    │    │
│  │  │ extension.ts│  │  client.ts   │  │  commands.ts    │    │    │
│  │  │ (activate)  │  │ (LSP client) │  │ (user actions)  │    │    │
│  │  └──────┬──────┘  └──────┬───────┘  └────────┬────────┘    │    │
│  │         │                │                    │             │    │
│  │  ┌──────┴────────────────┴────────────────────┴──────┐     │    │
│  │  │              SmartDiagnostics                      │     │    │
│  │  │  ┌──────────────┐ ┌────────────┐ ┌─────────────┐  │     │    │
│  │  │  │ChangeFilter  │ │ EditBuffer │ │ScopeTracker │  │     │    │
│  │  │  │(classify)    │ │ (buffer)   │ │(find scope) │  │     │    │
│  │  │  └──────────────┘ └────────────┘ └─────────────┘  │     │    │
│  │  └───────────────────────┬───────────────────────────┘     │    │
│  │                          │                                  │    │
│  │  ┌───────────────────────┼───────────────────────────┐     │    │
│  │  │ statusBar.ts  treeView.ts  inlayHints.ts  etc.    │     │    │
│  │  └───────────────────────┼───────────────────────────┘     │    │
│  └──────────────────────────┼──────────────────────────────────┘    │
│                             │                                        │
│                      JSON-RPC 2.0 (stdio)                           │
│                             │                                        │
└─────────────────────────────┼────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Vokt LSP Server (Go)                              │
│                    `vokt lsp serve`                                  │
│                                                                      │
│  Receives: vokt/checkDrift with scope context                       │
│  Returns: Diagnostics with SpecSays/ChangeSays                       │
└──────────────────────────────────────────────────────────────────────┘
```

### Data Flow: Smart Change Filtering

```
User Types
    │
    ▼
┌─────────────────────────────────┐
│     ChangeFilter.classify()     │
│  Is this comment/whitespace/    │
│  formatting only?               │
└─────────────────────────────────┘
    │
    ├── Yes → DISCARD (no LSP call)
    │
    └── No (significant change)
            │
            ▼
┌─────────────────────────────────┐
│      EditBuffer.addEdit()       │
│  Buffer the change, reset       │
│  idle timer (400ms)             │
└─────────────────────────────────┘
    │
    ├── Idle timeout fires (400ms no typing)
    │       │
    │       ▼
    │   ┌─────────────────────────────────┐
    │   │   ScopeTracker.getScope()       │
    │   │   Find enclosing function       │
    │   └─────────────────────────────────┘
    │       │
    │       ▼
    │   ┌─────────────────────────────────┐
    │   │   Send to LSP: vokt/checkDrift  │
    │   │   + scope context               │
    │   └─────────────────────────────────┘
    │
    └── User saves file
            │
            ▼
        FLUSH IMMEDIATELY → Send to LSP
```

---

## Repository Structure

```
vokt-vscode/
├── package.json              # Extension manifest
├── tsconfig.json             # TypeScript config
├── eslint.config.mjs         # ESLint 9.x flat config
├── .vscodeignore             # Files to exclude from VSIX
├── docs/
│   └── vscode-extension-architecture.md
└── src/
    ├── extension.ts          # Entry point (activate/deactivate)
    ├── client.ts             # LSP client setup
    ├── commands.ts           # User commands
    ├── diagnostics.ts        # SmartDiagnostics (filtering + buffering)
    ├── changeFilter.ts       # Change classification logic
    ├── scopeTracker.ts       # Enclosing scope detection
    ├── editBuffer.ts         # Edit buffering with idle timeout
    ├── statusBar.ts          # Status bar integration
    ├── treeView.ts           # Specs tree view provider
    ├── webview.ts            # Webview panel
    ├── inlayHints.ts         # Inlay hints provider
    ├── semanticTokens.ts     # Semantic token provider
    └── git.ts                # Git integration utilities
```

---

## Core Components

### 1. SmartDiagnostics (`src/diagnostics.ts`)

The central component that coordinates change filtering, buffering, and LSP communication.

```typescript
export class SmartDiagnostics implements vscode.Disposable {
    private changeFilter: ChangeFilter;
    private scopeTracker: ScopeTracker;
    private editBuffer: EditBuffer;
    private client: LanguageClient | undefined;

    // Called on every document change
    onDocumentChange(event: vscode.TextDocumentChangeEvent): void {
        // 1. Classify the change
        const classification = this.changeFilter.classify(event.document, event.contentChanges);

        // 2. Skip non-significant changes (comments, whitespace, formatting)
        if (!classification.isSignificant) {
            return;
        }

        // 3. Buffer significant changes
        this.editBuffer.addEdit(event.document, event.contentChanges);
    }

    // Called on document save - flush immediately
    onDocumentSave(document: vscode.TextDocument): void {
        const edits = this.editBuffer.flush(document.uri.toString());
        if (edits) {
            this.processEdits(uri, document, edits);
        }
    }
}
```

### 2. ChangeFilter (`src/changeFilter.ts`)

Classifies document changes to determine if they're behaviorally significant.

```typescript
export interface ChangeClassification {
    isSignificant: boolean;
    changeType: 'code' | 'comment' | 'whitespace' | 'formatting' | 'mixed';
    affectedRange: vscode.Range;
}

export class ChangeFilter {
    classify(
        document: vscode.TextDocument,
        changes: readonly vscode.TextDocumentContentChangeEvent[]
    ): ChangeClassification;
}
```

**Classification Logic:**
- `whitespace`: Only whitespace added/removed
- `formatting`: Same content, different whitespace (e.g., reindentation)
- `comment`: Change within comment tokens (language-aware)
- `code`: Actual code changes
- `mixed`: Combination of the above

**Supported Languages for Comment Detection:**
- Go, JavaScript, TypeScript, Python, Java, Rust, C, C++

### 3. ScopeTracker (`src/scopeTracker.ts`)

Finds the enclosing function/method/class for edit positions using VS Code's document symbols.

```typescript
export interface EditScope {
    name: string;
    kind: 'function' | 'method' | 'class' | 'module' | 'unknown';
    className?: string;  // For methods, the parent class name
    range: vscode.Range;
    symbolKind: vscode.SymbolKind;
}

export class ScopeTracker {
    async getEnclosingScope(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<EditScope | undefined>;

    async getEnclosingScopeForRange(
        document: vscode.TextDocument,
        range: vscode.Range
    ): Promise<EditScope | undefined>;
}
```

Uses `vscode.executeDocumentSymbolProvider` to get symbols and recursively finds the most specific enclosing scope.

### 4. EditBuffer (`src/editBuffer.ts`)

Buffers edits with configurable idle timeout to batch rapid changes.

```typescript
export class EditBuffer implements vscode.Disposable {
    constructor(idleMs: number = 400);

    addEdit(
        document: vscode.TextDocument,
        changes: readonly vscode.TextDocumentContentChangeEvent[]
    ): void;

    flush(uri: string): { document: vscode.TextDocument; edits: BufferedEdit[] } | undefined;

    onIdle(callback: IdleCallback): void;

    getCombinedRange(edits: BufferedEdit[]): vscode.Range;
}
```

**Behavior:**
- Each edit resets the idle timer
- After 400ms of no edits, fires the idle callback
- On file save, flushes immediately (no waiting)

---

## LSP Communication

### Request: `vokt/checkDrift`

Sent to the LSP server when buffered edits are ready to be processed.

```typescript
await client.sendRequest('vokt/checkDrift', {
    uri: document.uri.toString(),
    content: document.getText(),
    version: document.version,
    scope: scope ? {
        name: scope.name,
        kind: scope.kind,
        className: scope.className,
        range: {
            start: { line: scope.range.start.line, character: scope.range.start.character },
            end: { line: scope.range.end.line, character: scope.range.end.character },
        },
    } : undefined,
    affectedRange: {
        start: { line: range.start.line, character: range.start.character },
        end: { line: range.end.line, character: range.end.character },
    },
});
```

### Request: `vokt/getDocumentStatus`

Queries spec coverage for the status bar.

```typescript
const response = await client.sendRequest<{ hasSpec: boolean; coverage: number }>(
    'vokt/getDocumentStatus',
    { uri: document.uri.toString() }
);
```

---

## Commands

| Command | Title | Description |
|---------|-------|-------------|
| `vokt.showSpec` | Show Specification | Open the spec file for current document |
| `vokt.acknowledgeIntent` | Mark as Intended | Approve a detected behavioral change |
| `vokt.restartServer` | Restart LSP Server | Stop and restart the LSP connection |
| `vokt.generateSpec` | Generate Spec | Generate a spec for the current file |
| `vokt.refreshSpecs` | Refresh Specs | Refresh the specs tree view |
| `vokt.showDiff` | Show Git Diff | Show git diff for current file |
| `vokt.showWebview` | Show Webview | Open the Vokt webview panel |

---

## Configuration

All settings are under the `vokt` namespace.

### Server Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `vokt.serverPath` | string | `"vokt"` | Path to the vokt CLI executable |
| `vokt.trace.server` | enum | `"off"` | Trace LSP communication (`off`, `messages`, `verbose`) |

### Diagnostics Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `vokt.diagnostics.enabled` | boolean | `true` | Enable/disable drift detection |
| `vokt.diagnostics.debounceMs` | number | `500` | Idle timeout before sending to LSP |

### Filter Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `vokt.filter.ignoreComments` | boolean | `true` | Skip comment-only changes |
| `vokt.filter.ignoreWhitespace` | boolean | `true` | Skip whitespace-only changes |
| `vokt.filter.ignoreFormatting` | boolean | `true` | Skip formatting-only changes |

### Feature Toggles

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `vokt.inlayHints.enabled` | boolean | `true` | Show inline behavioral hints |
| `vokt.semanticHighlighting.enabled` | boolean | `true` | Highlight constrained code |
| `vokt.statusBar.enabled` | boolean | `true` | Show status bar item |
| `vokt.autoGenerateSpecs` | boolean | `true` | Auto-generate specs for new files |

---

## UI Components

### Status Bar (`src/statusBar.ts`)

Shows:
- LSP connection state (connected/disconnected/error)
- Spec coverage percentage for current file
- Click to show Vokt commands

### Tree View (`src/treeView.ts`)

Displays specs from `.vokt/specs/` directory:
- Organized by file
- Shows spec status icons
- Click to open spec file

### Inlay Hints (`src/inlayHints.ts`)

Inline hints showing:
- Behavioral constraints on functions
- Spec coverage indicators

### Semantic Tokens (`src/semanticTokens.ts`)

Highlights:
- Code sections with behavioral constraints
- Code sections with detected drift

### Webview (`src/webview.ts`)

Rich visualization panel for:
- Spec details
- Drift history
- Coverage reports

---

## Supported Languages

The extension activates for:
- Go
- Python
- TypeScript
- JavaScript
- Java
- Rust

Also activates when workspace contains a `.vokt` directory.

---

## Installation & Setup

### Prerequisites

1. **Vokt CLI installed**: The `vokt` binary must be in your PATH
2. **Vokt initialized**: Run `vokt init` in your project

### Installing the Extension

```bash
# From source
cd vokt-vscode
npm install
npm run compile
npm run package
code --install-extension vokt-vscode-0.1.0.vsix
```

### Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Watch mode
npm run watch

# Lint
npm run lint

# Package for distribution
npm run package
```

Press `F5` in VS Code to launch the Extension Development Host for testing.

---

## Verification Checklist

- [ ] Extension activates on workspace with `.vokt/`
- [ ] LSP server starts (check Output > Vokt)
- [ ] Status bar shows connection state
- [ ] Comment-only edit → no LSP call (check Output)
- [ ] Whitespace-only edit → no LSP call
- [ ] Code edit → LSP call with scope context
- [ ] File save → immediate flush
- [ ] Tree view shows specs
- [ ] Commands work (show spec, restart server, etc.)

---

## Output Logging

The extension logs to the "Vokt" output channel:

```
Vokt extension activating...
Vokt LSP server started
[SmartDiagnostics] Change in file.go: type=comment, significant=false
[SmartDiagnostics]   Filtered out (comment)
[SmartDiagnostics] Change in file.go: type=code, significant=true
[SmartDiagnostics]   Buffered (1 edits pending)
[SmartDiagnostics] Sending to LSP: 1 edits, scope=processOrder (function)
```

---

## Dependencies

### Runtime
- `vscode-languageclient` ^9.0.1

### Development
- `typescript` ^5.7.0
- `eslint` ^9.18.0
- `typescript-eslint` ^8.20.0
- `@types/vscode` ^1.96.0
- `@types/node` ^22.10.0
- `@vscode/vsce` ^3.2.0

---

## References

- [LSP Specification 3.17](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/)
- [VS Code Extension API](https://code.visualstudio.com/api)
- [vscode-languageclient](https://github.com/microsoft/vscode-languageserver-node)
