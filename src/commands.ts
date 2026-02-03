import * as vscode from 'vscode';
import { getClient, restartClient, VoktClientOptions } from './client';

export interface CommandContext {
    outputChannel: vscode.OutputChannel;
    clientOptions: VoktClientOptions;
}

export function registerCommands(
    context: vscode.ExtensionContext,
    commandContext: CommandContext
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('vokt.showSpec', () => showSpec(commandContext)),
        vscode.commands.registerCommand('vokt.acknowledgeIntent', acknowledgeIntent),
        vscode.commands.registerCommand('vokt.restartServer', () => restartServer(commandContext)),
        vscode.commands.registerCommand('vokt.generateSpec', () => generateSpec(commandContext)),
        vscode.commands.registerCommand('vokt.refreshSpecs', refreshSpecs),
        vscode.commands.registerCommand('vokt.showDiff', showDiff)
    );
}

async function showSpec(ctx: CommandContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const client = getClient();
    if (!client || !client.isRunning()) {
        vscode.window.showWarningMessage('Vokt LSP server is not running');
        return;
    }

    try {
        // Request spec information from the LSP server
        const response = await client.sendRequest<SpecInfoResponse>('vokt/getSpecInfo', {
            uri: editor.document.uri.toString(),
        });

        if (response && response.specPath) {
            // Open the spec file
            const specUri = vscode.Uri.file(response.specPath);
            const doc = await vscode.workspace.openTextDocument(specUri);
            await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
        } else {
            const action = await vscode.window.showInformationMessage(
                'No spec found for this file. Would you like to generate one?',
                'Generate Spec',
                'Cancel'
            );
            if (action === 'Generate Spec') {
                await generateSpec(ctx);
            }
        }
    } catch (error) {
        ctx.outputChannel.appendLine(`Error showing spec: ${error}`);
        vscode.window.showErrorMessage(`Failed to show spec: ${error}`);
    }
}

async function acknowledgeIntent(uri?: string, code?: string): Promise<void> {
    const client = getClient();
    if (!client || !client.isRunning()) {
        vscode.window.showWarningMessage('Vokt LSP server is not running');
        return;
    }

    // If called without arguments, get from active editor
    if (!uri) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor');
            return;
        }
        uri = editor.document.uri.toString();
    }

    try {
        // Send acknowledge intent request to LSP server
        await client.sendRequest('vokt/acknowledgeIntent', {
            uri,
            code,
        });

        vscode.window.showInformationMessage(
            code ? `Marked ${code} as intended` : 'Marked change as intended'
        );
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to acknowledge intent: ${error}`);
    }
}

async function restartServer(ctx: CommandContext): Promise<void> {
    try {
        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Restarting Vokt LSP Server...',
                cancellable: false,
            },
            async () => {
                await restartClient(ctx.clientOptions);
            }
        );
        vscode.window.showInformationMessage('Vokt LSP server restarted');
    } catch (error) {
        ctx.outputChannel.appendLine(`Error restarting server: ${error}`);
        vscode.window.showErrorMessage(`Failed to restart server: ${error}`);
    }
}

async function generateSpec(ctx: CommandContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const client = getClient();
    if (!client || !client.isRunning()) {
        vscode.window.showWarningMessage('Vokt LSP server is not running');
        return;
    }

    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Generating spec...',
                cancellable: false,
            },
            async (progress) => {
                progress.report({ message: 'Analyzing file...' });

                const response = await client.sendRequest<GenerateSpecResponse>(
                    'vokt/generateSpec',
                    {
                        uri: editor.document.uri.toString(),
                    }
                );

                if (response && response.success) {
                    progress.report({ message: 'Spec generated!' });
                    vscode.window.showInformationMessage(
                        `Spec generated: ${response.specPath}`
                    );

                    // Optionally open the generated spec
                    if (response.specPath) {
                        const action = await vscode.window.showInformationMessage(
                            'Spec generated successfully. Would you like to view it?',
                            'View Spec',
                            'Close'
                        );
                        if (action === 'View Spec') {
                            const specUri = vscode.Uri.file(response.specPath);
                            const doc = await vscode.workspace.openTextDocument(specUri);
                            await vscode.window.showTextDocument(doc, {
                                preview: true,
                                viewColumn: vscode.ViewColumn.Beside,
                            });
                        }
                    }
                } else {
                    vscode.window.showErrorMessage(
                        response?.error || 'Failed to generate spec'
                    );
                }
            }
        );
    } catch (error) {
        ctx.outputChannel.appendLine(`Error generating spec: ${error}`);
        vscode.window.showErrorMessage(`Failed to generate spec: ${error}`);
    }
}

async function refreshSpecs(): Promise<void> {
    const client = getClient();
    if (!client || !client.isRunning()) {
        vscode.window.showWarningMessage('Vokt LSP server is not running');
        return;
    }

    try {
        await client.sendRequest('vokt/refreshSpecs', {});
        vscode.commands.executeCommand('voktSpecs.refresh');
        vscode.window.showInformationMessage('Specs refreshed');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to refresh specs: ${error}`);
    }
}

async function showDiff(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!workspaceFolder) {
        vscode.window.showWarningMessage('File is not in a workspace');
        return;
    }

    try {
        // Use VS Code's built-in git extension to show diff
        const gitExtension = vscode.extensions.getExtension('vscode.git');
        if (!gitExtension) {
            vscode.window.showWarningMessage('Git extension is not available');
            return;
        }

        const git = gitExtension.exports.getAPI(1);
        const repo = git.getRepository(editor.document.uri);

        if (!repo) {
            vscode.window.showWarningMessage('No git repository found');
            return;
        }

        // Open diff view for current file
        await vscode.commands.executeCommand('git.openChange', editor.document.uri);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to show diff: ${error}`);
    }
}

// Response types for LSP custom requests
interface SpecInfoResponse {
    specPath?: string;
    hasSpec: boolean;
    specVersion?: number;
    lastUpdated?: string;
}

interface GenerateSpecResponse {
    success: boolean;
    specPath?: string;
    error?: string;
}
