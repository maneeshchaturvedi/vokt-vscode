import * as vscode from 'vscode';

export interface BufferedEdit {
    changes: readonly vscode.TextDocumentContentChangeEvent[];
    timestamp: number;
    version: number;
}

export type IdleCallback = (uri: string, document: vscode.TextDocument, edits: BufferedEdit[]) => void;

export class EditBuffer implements vscode.Disposable {
    private buffer: Map<string, { document: vscode.TextDocument; edits: BufferedEdit[] }> = new Map();
    private timers: Map<string, NodeJS.Timeout> = new Map();
    private idleMs: number;
    private idleCallback: IdleCallback | undefined;
    private disposables: vscode.Disposable[] = [];

    constructor(idleMs: number = 400) {
        this.idleMs = idleMs;
    }

    setIdleMs(ms: number): void {
        this.idleMs = ms;
    }

    onIdle(callback: IdleCallback): void {
        this.idleCallback = callback;
    }

    addEdit(
        document: vscode.TextDocument,
        changes: readonly vscode.TextDocumentContentChangeEvent[]
    ): void {
        const uri = document.uri.toString();

        // Get or create buffer entry
        let entry = this.buffer.get(uri);
        if (!entry) {
            entry = { document, edits: [] };
            this.buffer.set(uri, entry);
        }

        // Update document reference (it may have changed)
        entry.document = document;

        // Add the edit
        entry.edits.push({
            changes,
            timestamp: Date.now(),
            version: document.version,
        });

        // Reset idle timer
        this.resetTimer(uri);
    }

    flush(uri: string): { document: vscode.TextDocument; edits: BufferedEdit[] } | undefined {
        this.cancelTimer(uri);
        const entry = this.buffer.get(uri);
        this.buffer.delete(uri);
        return entry;
    }

    flushAll(): Map<string, { document: vscode.TextDocument; edits: BufferedEdit[] }> {
        // Cancel all timers
        for (const uri of this.timers.keys()) {
            this.cancelTimer(uri);
        }

        // Get all buffered edits
        const result = new Map(this.buffer);
        this.buffer.clear();
        return result;
    }

    hasBufferedEdits(uri: string): boolean {
        const entry = this.buffer.get(uri);
        return entry !== undefined && entry.edits.length > 0;
    }

    getBufferedEditCount(uri: string): number {
        const entry = this.buffer.get(uri);
        return entry?.edits.length ?? 0;
    }

    private resetTimer(uri: string): void {
        this.cancelTimer(uri);

        const timer = setTimeout(() => {
            try {
                this.timers.delete(uri);
                this.onTimerFired(uri);
            } catch (error) {
                console.error('[EditBuffer] Timer callback error:', error);
            }
        }, this.idleMs);

        this.timers.set(uri, timer);
    }

    private cancelTimer(uri: string): void {
        const timer = this.timers.get(uri);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(uri);
        }
    }

    private onTimerFired(uri: string): void {
        const entry = this.buffer.get(uri);
        if (!entry || entry.edits.length === 0) {
            return;
        }

        // Clear buffer
        this.buffer.delete(uri);

        // Invoke callback with error handling
        if (this.idleCallback) {
            try {
                this.idleCallback(uri, entry.document, entry.edits);
            } catch (error) {
                console.error('[EditBuffer] Idle callback error:', error);
            }
        }
    }

    getCombinedRange(edits: BufferedEdit[]): vscode.Range {
        if (edits.length === 0) {
            return new vscode.Range(0, 0, 0, 0);
        }

        let startLine = Number.MAX_SAFE_INTEGER;
        let startChar = Number.MAX_SAFE_INTEGER;
        let endLine = 0;
        let endChar = 0;

        for (const edit of edits) {
            for (const change of edit.changes) {
                if (change.range.start.line < startLine ||
                    (change.range.start.line === startLine && change.range.start.character < startChar)) {
                    startLine = change.range.start.line;
                    startChar = change.range.start.character;
                }
                if (change.range.end.line > endLine ||
                    (change.range.end.line === endLine && change.range.end.character > endChar)) {
                    endLine = change.range.end.line;
                    endChar = change.range.end.character;
                }
            }
        }

        // Handle case where no valid ranges were found
        if (startLine === Number.MAX_SAFE_INTEGER) {
            return new vscode.Range(0, 0, 0, 0);
        }

        return new vscode.Range(startLine, startChar, endLine, endChar);
    }

    dispose(): void {
        // Cancel all timers
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
        this.buffer.clear();
        this.disposables.forEach((d) => d.dispose());
    }
}
