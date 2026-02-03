import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { ChangeFilter, FilterConfig } from './changeFilter';
import { ScopeTracker, EditScope } from './scopeTracker';
import { EditBuffer, BufferedEdit } from './editBuffer';

export interface SmartDiagnosticsConfig {
    idleMs: number;
    filter: Partial<FilterConfig>;
    enabled: boolean;
}

const DEFAULT_CONFIG: SmartDiagnosticsConfig = {
    idleMs: 400,
    filter: {
        ignoreComments: true,
        ignoreWhitespace: true,
        ignoreFormatting: true,
    },
    enabled: true,
};

export class SmartDiagnostics implements vscode.Disposable {
    private changeFilter: ChangeFilter;
    private scopeTracker: ScopeTracker;
    private editBuffer: EditBuffer;
    private client: LanguageClient | undefined;
    private config: SmartDiagnosticsConfig;
    private outputChannel: vscode.OutputChannel | undefined;
    private disposables: vscode.Disposable[] = [];

    // Stats for debugging
    private stats = {
        totalChanges: 0,
        filteredOut: 0,
        sentToLsp: 0,
    };

    // Track consecutive LSP failures for user notification
    private consecutiveFailures = 0;
    private static readonly FAILURE_THRESHOLD = 3;
    private lastNotificationTime = 0;
    private static readonly NOTIFICATION_COOLDOWN_MS = 60000; // 1 minute between notifications

    constructor(config: Partial<SmartDiagnosticsConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.changeFilter = new ChangeFilter(this.config.filter);
        this.scopeTracker = new ScopeTracker();
        this.editBuffer = new EditBuffer(this.config.idleMs);

        // Set up idle callback
        this.editBuffer.onIdle((uri, document, edits) => {
            this.processEdits(uri, document, edits);
        });
    }

    setClient(client: LanguageClient): void {
        this.client = client;
    }

    setOutputChannel(channel: vscode.OutputChannel): void {
        this.outputChannel = channel;
    }

    updateConfig(config: Partial<SmartDiagnosticsConfig>): void {
        if (config.idleMs !== undefined) {
            this.config.idleMs = config.idleMs;
            this.editBuffer.setIdleMs(config.idleMs);
        }
        if (config.filter !== undefined) {
            this.config.filter = { ...this.config.filter, ...config.filter };
            this.changeFilter.updateConfig(this.config.filter);
        }
        if (config.enabled !== undefined) {
            this.config.enabled = config.enabled;
        }
    }

    onDocumentChange(event: vscode.TextDocumentChangeEvent): void {
        if (!this.config.enabled) {
            return;
        }

        // Only process file:// scheme documents (ignore output channels, untitled, etc.)
        if (event.document.uri.scheme !== 'file') {
            return;
        }

        this.stats.totalChanges++;

        // Classify the changes
        const classification = this.changeFilter.classify(
            event.document,
            event.contentChanges
        );

        this.log(
            `Change in ${event.document.fileName}: type=${classification.changeType}, significant=${classification.isSignificant}`
        );

        // Skip non-significant changes
        if (!classification.isSignificant) {
            this.stats.filteredOut++;
            this.log(`  Filtered out (${classification.changeType})`);
            return;
        }

        // Buffer significant changes
        this.editBuffer.addEdit(event.document, event.contentChanges);
        this.log(`  Buffered (${this.editBuffer.getBufferedEditCount(event.document.uri.toString())} edits pending)`);
    }

    onDocumentSave(document: vscode.TextDocument): void {
        if (!this.config.enabled) {
            return;
        }

        // Only process file:// scheme documents
        if (document.uri.scheme !== 'file') {
            return;
        }

        const uri = document.uri.toString();

        // Flush immediately on save
        if (this.editBuffer.hasBufferedEdits(uri)) {
            const entry = this.editBuffer.flush(uri);
            if (entry) {
                this.log(`Flushing on save: ${entry.edits.length} edits`);
                this.processEdits(uri, entry.document, entry.edits);
            }
        }
    }

    private async processEdits(
        uri: string,
        document: vscode.TextDocument,
        edits: BufferedEdit[]
    ): Promise<void> {
        if (!this.client || !this.client.isRunning()) {
            this.log('LSP client not running, skipping drift check');
            return;
        }

        if (edits.length === 0) {
            return;
        }

        this.stats.sentToLsp++;

        // Get combined range of all edits
        const combinedRange = this.editBuffer.getCombinedRange(edits);

        // Get enclosing scope
        let scope: EditScope | undefined;
        try {
            scope = await this.scopeTracker.getEnclosingScopeForRange(document, combinedRange);
        } catch (error) {
            this.log(`Failed to get scope: ${error}`);
        }

        this.log(
            `Sending to LSP: ${edits.length} edits, scope=${scope?.name ?? 'none'} (${scope?.kind ?? 'unknown'})`
        );

        // Send to LSP
        await this.sendToLSP(document, scope, combinedRange);
    }

    private async sendToLSP(
        document: vscode.TextDocument,
        scope: EditScope | undefined,
        affectedRange: vscode.Range
    ): Promise<void> {
        if (!this.client) {
            return;
        }

        try {
            await this.client.sendRequest('vokt/checkDrift', {
                uri: document.uri.toString(),
                content: document.getText(),
                version: document.version,
                scope: scope
                    ? {
                          name: scope.name,
                          kind: scope.kind,
                          className: scope.className,
                          range: {
                              start: {
                                  line: scope.range.start.line,
                                  character: scope.range.start.character,
                              },
                              end: {
                                  line: scope.range.end.line,
                                  character: scope.range.end.character,
                              },
                          },
                      }
                    : undefined,
                affectedRange: {
                    start: {
                        line: affectedRange.start.line,
                        character: affectedRange.start.character,
                    },
                    end: {
                        line: affectedRange.end.line,
                        character: affectedRange.end.character,
                    },
                },
            });

            // Reset failure count on success
            this.consecutiveFailures = 0;
        } catch (error) {
            this.log(`Drift check failed: ${error}`);
            this.handleLspFailure(error);
        }
    }

    /**
     * Handles LSP failures with user notification after threshold
     */
    private handleLspFailure(_error: unknown): void {
        this.consecutiveFailures++;

        if (this.consecutiveFailures >= SmartDiagnostics.FAILURE_THRESHOLD) {
            const now = Date.now();
            // Only show notification if cooldown has passed
            if (now - this.lastNotificationTime > SmartDiagnostics.NOTIFICATION_COOLDOWN_MS) {
                this.lastNotificationTime = now;
                vscode.window.showWarningMessage(
                    'Vokt: Drift detection temporarily unavailable. Check Output > Vokt for details.',
                    'Show Output'
                ).then(selection => {
                    if (selection === 'Show Output' && this.outputChannel) {
                        this.outputChannel.show();
                    }
                });
            }
            // Reset counter after notification
            this.consecutiveFailures = 0;
        }
    }

    private log(message: string): void {
        if (this.outputChannel) {
            this.outputChannel.appendLine(`[SmartDiagnostics] ${message}`);
        }
    }

    getStats(): { totalChanges: number; filteredOut: number; sentToLsp: number } {
        return { ...this.stats };
    }

    resetStats(): void {
        this.stats = { totalChanges: 0, filteredOut: 0, sentToLsp: 0 };
    }

    dispose(): void {
        this.editBuffer.dispose();
        this.scopeTracker.clearCache();
        this.disposables.forEach((d) => d.dispose());
    }
}

// Keep existing utility types and functions for backwards compatibility

export interface DiagnosticEnhancer {
    enhance(diagnostics: vscode.Diagnostic[]): vscode.Diagnostic[];
}

export class PositionAwareDiagnostics implements DiagnosticEnhancer {
    enhance(diagnostics: vscode.Diagnostic[]): vscode.Diagnostic[] {
        return diagnostics.map((diagnostic) => {
            if (diagnostic.range.start.line === 0 && diagnostic.range.end.line === 0) {
                const lineMatch = diagnostic.message.match(/line (\d+)/i);
                if (lineMatch) {
                    const line = parseInt(lineMatch[1], 10) - 1;
                    diagnostic.range = new vscode.Range(line, 0, line, 1000);
                }
            }
            return diagnostic;
        });
    }
}

export function createDiagnosticFromConflict(
    conflict: DriftConflict,
    document: vscode.TextDocument
): vscode.Diagnostic {
    let range: vscode.Range;
    if (conflict.startLine !== undefined && conflict.endLine !== undefined) {
        range = new vscode.Range(
            conflict.startLine,
            conflict.startColumn || 0,
            conflict.endLine,
            conflict.endColumn || document.lineAt(conflict.endLine).text.length
        );
    } else {
        range = new vscode.Range(0, 0, 0, 1);
    }

    let severity: vscode.DiagnosticSeverity;
    switch (conflict.impact) {
        case 'high':
            severity = vscode.DiagnosticSeverity.Error;
            break;
        case 'medium':
            severity = vscode.DiagnosticSeverity.Warning;
            break;
        case 'low':
            severity = vscode.DiagnosticSeverity.Information;
            break;
        default:
            severity = vscode.DiagnosticSeverity.Warning;
    }

    let message = `Behavioral change: ${conflict.description}\n`;
    message += `  Spec says: ${conflict.specSays}\n`;
    message += `  Change says: ${conflict.changeSays}`;

    const diagnostic = new vscode.Diagnostic(range, message, severity);
    diagnostic.source = 'vokt';
    diagnostic.code = `vokt.drift.${conflict.type}.${conflict.index}`;

    if (conflict.relatedLocations && conflict.relatedLocations.length > 0) {
        diagnostic.relatedInformation = conflict.relatedLocations.map((loc) => {
            const relatedRange = new vscode.Range(
                loc.startLine,
                loc.startColumn || 0,
                loc.endLine,
                loc.endColumn || 0
            );
            return new vscode.DiagnosticRelatedInformation(
                new vscode.Location(document.uri, relatedRange),
                loc.message
            );
        });
    }

    return diagnostic;
}

export interface DriftConflict {
    type: string;
    index: number;
    description: string;
    specSays: string;
    changeSays: string;
    impact: 'high' | 'medium' | 'low';
    startLine?: number;
    startColumn?: number;
    endLine?: number;
    endColumn?: number;
    relatedLocations?: Array<{
        startLine: number;
        startColumn?: number;
        endLine: number;
        endColumn?: number;
        message: string;
    }>;
}

// Legacy export for backwards compatibility
export { SmartDiagnostics as DebouncedDiagnostics };
