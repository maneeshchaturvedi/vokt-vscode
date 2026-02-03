import * as vscode from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export interface VoktClientOptions {
    serverPath: string;
    workspaceFolder?: vscode.WorkspaceFolder;
    outputChannel: vscode.OutputChannel;
}

export function createLanguageClient(options: VoktClientOptions): LanguageClient {
    const { serverPath, workspaceFolder, outputChannel } = options;

    const serverOptions: ServerOptions = {
        command: serverPath,
        args: ['lsp', 'serve'],
        transport: TransportKind.stdio,
        options: {
            cwd: workspaceFolder?.uri.fsPath,
            env: {
                ...process.env,
                VOKT_LSP_MODE: '1',
            },
        },
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: 'file', language: 'go' },
            { scheme: 'file', language: 'python' },
            { scheme: 'file', language: 'typescript' },
            { scheme: 'file', language: 'javascript' },
            { scheme: 'file', language: 'java' },
            { scheme: 'file', language: 'rust' },
            { scheme: 'file', language: 'c' },
            { scheme: 'file', language: 'cpp' },
        ],
        synchronize: {
            fileEvents: [
                vscode.workspace.createFileSystemWatcher('**/.vokt/**'),
                vscode.workspace.createFileSystemWatcher('**/*.yaml'),
                vscode.workspace.createFileSystemWatcher('**/*.yml'),
            ],
        },
        outputChannel,
        traceOutputChannel: outputChannel,
        workspaceFolder,
        initializationOptions: {
            diagnostics: {
                enabled: vscode.workspace.getConfiguration('vokt').get('diagnostics.enabled', true),
                debounceMs: vscode.workspace.getConfiguration('vokt').get('diagnostics.debounceMs', 500),
            },
            inlayHints: {
                enabled: vscode.workspace.getConfiguration('vokt').get('inlayHints.enabled', true),
            },
            semanticHighlighting: {
                enabled: vscode.workspace.getConfiguration('vokt').get('semanticHighlighting.enabled', true),
            },
            autoGenerateSpecs: vscode.workspace.getConfiguration('vokt').get('autoGenerateSpecs', true),
        },
        middleware: {
            handleDiagnostics: (uri, diagnostics, next) => {
                // Allow filtering or processing diagnostics before display
                const config = vscode.workspace.getConfiguration('vokt');
                if (!config.get('diagnostics.enabled', true)) {
                    return;
                }
                next(uri, diagnostics);
            },
        },
    };

    client = new LanguageClient(
        'vokt',
        'Vokt Language Server',
        serverOptions,
        clientOptions
    );

    return client;
}

export function getClient(): LanguageClient | undefined {
    return client;
}

export async function startClient(languageClient: LanguageClient): Promise<void> {
    await languageClient.start();
}

export async function stopClient(): Promise<void> {
    if (client) {
        await client.stop();
        client = undefined;
    }
}

export async function restartClient(options: VoktClientOptions): Promise<LanguageClient> {
    await stopClient();
    const newClient = createLanguageClient(options);
    await startClient(newClient);
    return newClient;
}

export function isClientRunning(): boolean {
    return client !== undefined && client.isRunning();
}
