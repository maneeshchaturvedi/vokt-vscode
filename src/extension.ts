import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import {
    createLanguageClient,
    startClient,
    stopClient,
    VoktClientOptions,
} from './client';
import { registerCommands, CommandContext } from './commands';
import { VoktStatusBar } from './statusBar';
import { VoktSpecsTreeProvider } from './treeView';
import { VoktWebviewPanel } from './webview';
import { SmartDiagnostics } from './diagnostics';
import { VoktInlayHintsProvider } from './inlayHints';
import { VoktSemanticTokensProvider, legend } from './semanticTokens';

let client: LanguageClient | undefined;
let statusBar: VoktStatusBar | undefined;
let treeProvider: VoktSpecsTreeProvider | undefined;
let smartDiagnostics: SmartDiagnostics | undefined;
let outputChannel: vscode.OutputChannel;

// Constants for retry logic
const MAX_SERVER_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 10000;

/**
 * Starts the LSP server with exponential backoff retry logic
 */
async function startServerWithRetry(
    clientOptions: VoktClientOptions,
    maxRetries: number = MAX_SERVER_RETRIES
): Promise<LanguageClient> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const newClient = createLanguageClient(clientOptions);
            await startClient(newClient);
            return newClient;
        } catch (error) {
            lastError = error as Error;
            const delay = Math.min(
                INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1),
                MAX_RETRY_DELAY_MS
            );

            outputChannel.appendLine(
                `LSP server start failed (attempt ${attempt}/${maxRetries}): ${error}`
            );

            if (attempt < maxRetries) {
                outputChannel.appendLine(`Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    throw lastError ?? new Error('Failed to start LSP server');
}

/**
 * Validates configuration values and warns about invalid settings
 */
function validateConfig(config: vscode.WorkspaceConfiguration): void {
    const debounceMs = config.get<number>('diagnostics.debounceMs', 400);
    if (debounceMs < 100 || debounceMs > 10000) {
        outputChannel.appendLine(
            `Warning: diagnostics.debounceMs (${debounceMs}) is outside recommended range (100-10000ms)`
        );
        vscode.window.showWarningMessage(
            `Vokt: diagnostics.debounceMs (${debounceMs}) should be between 100-10000ms for optimal performance.`
        );
    }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    outputChannel = vscode.window.createOutputChannel('Vokt');
    outputChannel.appendLine('Vokt extension activating...');

    const config = vscode.workspace.getConfiguration('vokt');
    const serverPath = config.get<string>('serverPath', 'vokt');
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    // Validate configuration
    validateConfig(config);

    // Create client options
    const clientOptions: VoktClientOptions = {
        serverPath,
        workspaceFolder,
        outputChannel,
    };

    // Create command context
    const commandContext: CommandContext = {
        outputChannel,
        clientOptions,
    };

    // Register commands
    registerCommands(context, commandContext);

    // Initialize status bar (Phase 3)
    if (config.get('statusBar.enabled', true)) {
        statusBar = new VoktStatusBar();
        context.subscriptions.push(statusBar);
    }

    // Initialize tree view provider (Phase 3)
    treeProvider = new VoktSpecsTreeProvider(workspaceFolder?.uri.fsPath);
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('voktSpecs', treeProvider)
    );

    // Register webview command (Phase 3)
    context.subscriptions.push(
        vscode.commands.registerCommand('vokt.showWebview', () => {
            VoktWebviewPanel.createOrShow(context.extensionUri);
        })
    );

    // Initialize smart diagnostics with filtering and buffering
    const idleMs = config.get<number>('diagnostics.debounceMs', 400);
    smartDiagnostics = new SmartDiagnostics({
        idleMs,
        enabled: config.get<boolean>('diagnostics.enabled', true),
        filter: {
            ignoreComments: config.get<boolean>('filter.ignoreComments', true),
            ignoreWhitespace: config.get<boolean>('filter.ignoreWhitespace', true),
            ignoreFormatting: config.get<boolean>('filter.ignoreFormatting', true),
        },
    });
    smartDiagnostics.setOutputChannel(outputChannel);
    context.subscriptions.push(smartDiagnostics);

    // Register inlay hints provider (Phase 2)
    if (config.get('inlayHints.enabled', true)) {
        const inlayHintsProvider = new VoktInlayHintsProvider();
        context.subscriptions.push(
            vscode.languages.registerInlayHintsProvider(
                [
                    { scheme: 'file', language: 'go' },
                    { scheme: 'file', language: 'python' },
                    { scheme: 'file', language: 'typescript' },
                    { scheme: 'file', language: 'javascript' },
                    { scheme: 'file', language: 'java' },
                    { scheme: 'file', language: 'rust' },
                ],
                inlayHintsProvider
            )
        );
    }

    // Register semantic tokens provider (Phase 2)
    if (config.get('semanticHighlighting.enabled', true)) {
        const semanticTokensProvider = new VoktSemanticTokensProvider();
        context.subscriptions.push(
            vscode.languages.registerDocumentSemanticTokensProvider(
                [
                    { scheme: 'file', language: 'go' },
                    { scheme: 'file', language: 'python' },
                    { scheme: 'file', language: 'typescript' },
                    { scheme: 'file', language: 'javascript' },
                    { scheme: 'file', language: 'java' },
                    { scheme: 'file', language: 'rust' },
                ],
                semanticTokensProvider,
                legend
            )
        );
    }

    // Create and start the language client with retry logic
    try {
        outputChannel.appendLine('Starting Vokt LSP server...');
        client = await startServerWithRetry(clientOptions);

        // Set up client event handlers
        client.onDidChangeState((event) => {
            outputChannel.appendLine(`Client state changed: ${event.oldState} -> ${event.newState}`);
            statusBar?.updateState(event.newState);
        });

        outputChannel.appendLine('Vokt LSP server started successfully');

        // Connect smart diagnostics to the client
        smartDiagnostics.setClient(client);

        // Update status bar with initial state
        statusBar?.setConnected(true);

        // Refresh tree view after client starts
        treeProvider?.refresh();
    } catch (error) {
        outputChannel.appendLine(`Failed to start Vokt LSP server after ${MAX_SERVER_RETRIES} attempts: ${error}`);
        vscode.window.showErrorMessage(
            `Failed to start Vokt LSP server after ${MAX_SERVER_RETRIES} attempts. ` +
            `Make sure 'vokt' is installed and in your PATH. Check Output > Vokt for details.`
        );
        statusBar?.setConnected(false);
    }

    // Watch for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('vokt')) {
                handleConfigurationChange(context, clientOptions);
            }
        })
    );

    // Watch for document changes - filtered and buffered by SmartDiagnostics
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            smartDiagnostics?.onDocumentChange(event);
        })
    );

    // Watch for document saves - flush buffer immediately
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            smartDiagnostics?.onDocumentSave(document);
        })
    );

    // Watch for active editor changes to update status bar
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor && statusBar) {
                updateStatusBarForDocument(editor.document);
            }
        })
    );

    outputChannel.appendLine('Vokt extension activated');
}

export async function deactivate(): Promise<void> {
    outputChannel?.appendLine('Vokt extension deactivating...');

    // Dispose smart diagnostics first (depends on client)
    if (smartDiagnostics) {
        try {
            const stats = smartDiagnostics.getStats();
            outputChannel?.appendLine(
                `SmartDiagnostics stats: ${stats.totalChanges} total changes, ` +
                `${stats.filteredOut} filtered out, ${stats.sentToLsp} sent to LSP`
            );
            smartDiagnostics.dispose();
        } catch (error) {
            outputChannel?.appendLine(`Warning: SmartDiagnostics dispose error: ${error}`);
        }
        smartDiagnostics = undefined;
    }

    // Dispose status bar
    if (statusBar) {
        try {
            statusBar.dispose();
        } catch (error) {
            outputChannel?.appendLine(`Warning: StatusBar dispose error: ${error}`);
        }
        statusBar = undefined;
    }

    // Clear tree provider reference
    treeProvider = undefined;

    // Stop client with timeout to prevent hanging
    if (client) {
        try {
            const CLIENT_STOP_TIMEOUT_MS = 5000;
            await Promise.race([
                stopClient(),
                new Promise<void>((_, reject) =>
                    setTimeout(
                        () => reject(new Error('Client stop timeout')),
                        CLIENT_STOP_TIMEOUT_MS
                    )
                )
            ]);
            outputChannel?.appendLine('LSP client stopped');
        } catch (error) {
            outputChannel?.appendLine(`Warning: Client stop failed: ${error}`);
        }
        client = undefined;
    }

    outputChannel?.appendLine('Vokt extension deactivated');
}

async function handleConfigurationChange(
    context: vscode.ExtensionContext,
    clientOptions: VoktClientOptions
): Promise<void> {
    const config = vscode.workspace.getConfiguration('vokt');

    // Update server path if changed
    const newServerPath = config.get<string>('serverPath', 'vokt');
    if (newServerPath !== clientOptions.serverPath) {
        clientOptions.serverPath = newServerPath;
        // Restart server with new path
        await vscode.commands.executeCommand('vokt.restartServer');
    }

    // Update smart diagnostics configuration
    smartDiagnostics?.updateConfig({
        idleMs: config.get<number>('diagnostics.debounceMs', 400),
        enabled: config.get<boolean>('diagnostics.enabled', true),
        filter: {
            ignoreComments: config.get<boolean>('filter.ignoreComments', true),
            ignoreWhitespace: config.get<boolean>('filter.ignoreWhitespace', true),
            ignoreFormatting: config.get<boolean>('filter.ignoreFormatting', true),
        },
    });

    // Update status bar visibility
    const statusBarEnabled = config.get('statusBar.enabled', true);
    if (statusBarEnabled) {
        if (!statusBar) {
            statusBar = new VoktStatusBar();
            context.subscriptions.push(statusBar);
        }
        statusBar.show();
    } else {
        // Properly dispose when disabled
        if (statusBar) {
            statusBar.dispose();
            statusBar = undefined;
        }
    }

    // Re-validate config on changes
    validateConfig(config);
}

async function updateStatusBarForDocument(document: vscode.TextDocument): Promise<void> {
    if (!client?.isRunning() || !statusBar) {
        return;
    }

    try {
        const response = await client.sendRequest<{ hasSpec: boolean; coverage: number }>(
            'vokt/getDocumentStatus',
            { uri: document.uri.toString() }
        );

        statusBar.updateCoverage(response.hasSpec, response.coverage);
    } catch {
        // Ignore errors for non-applicable documents
    }
}
