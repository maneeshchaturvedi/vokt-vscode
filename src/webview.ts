import * as vscode from 'vscode';
import { getClient } from './client';

export class VoktWebviewPanel {
    public static currentPanel: VoktWebviewPanel | undefined;
    public static readonly viewType = 'voktSpecViewer';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (VoktWebviewPanel.currentPanel) {
            VoktWebviewPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            VoktWebviewPanel.viewType,
            'Vokt Specification',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media'),
                    vscode.Uri.joinPath(extensionUri, 'out'),
                ],
            }
        );

        VoktWebviewPanel.currentPanel = new VoktWebviewPanel(panel, extensionUri);
    }

    public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): void {
        VoktWebviewPanel.currentPanel = new VoktWebviewPanel(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.onDidChangeViewState(
            () => {
                if (this._panel.visible) {
                    this._update();
                }
            },
            null,
            this._disposables
        );

        this._panel.webview.onDidReceiveMessage(
            (message) => this._handleMessage(message),
            null,
            this._disposables
        );
    }

    public async showSpec(specPath: string): Promise<void> {
        const client = getClient();
        if (!client || !client.isRunning()) {
            return;
        }

        try {
            const response = await client.sendRequest<SpecDetails>(
                'vokt/getSpecDetails',
                { specPath }
            );

            if (response) {
                this._panel.webview.postMessage({
                    type: 'showSpec',
                    spec: response,
                });
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load spec: ${error}`);
        }
    }

    private async _handleMessage(message: WebviewMessage): Promise<void> {
        switch (message.type) {
            case 'requestSpec':
                if (message.uri) {
                    await this.showSpecForFile(message.uri);
                }
                break;
            case 'acknowledgeIntent':
                await vscode.commands.executeCommand(
                    'vokt.acknowledgeIntent',
                    message.uri,
                    message.code
                );
                break;
            case 'openFile':
                if (message.path) {
                    const doc = await vscode.workspace.openTextDocument(
                        vscode.Uri.file(message.path)
                    );
                    await vscode.window.showTextDocument(doc);
                }
                break;
            case 'refresh':
                this._update();
                break;
        }
    }

    private async showSpecForFile(uri: string): Promise<void> {
        const client = getClient();
        if (!client || !client.isRunning()) {
            return;
        }

        try {
            const response = await client.sendRequest<SpecDetails>(
                'vokt/getSpecForFile',
                { uri }
            );

            if (response) {
                this._panel.webview.postMessage({
                    type: 'showSpec',
                    spec: response,
                });
            }
        } catch (error) {
            console.error('Failed to get spec for file:', error);
        }
    }

    private _update(): void {
        const webview = this._panel.webview;
        this._panel.title = 'Vokt Specification';
        webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Vokt Specification</title>
    <style>
        :root {
            --container-padding: 20px;
            --input-padding-vertical: 6px;
            --input-padding-horizontal: 4px;
            --input-margin-vertical: 4px;
            --input-margin-horizontal: 0;
        }

        body {
            padding: 0 var(--container-padding);
            color: var(--vscode-foreground);
            font-size: var(--vscode-font-size);
            font-weight: var(--vscode-font-weight);
            font-family: var(--vscode-font-family);
            background-color: var(--vscode-editor-background);
        }

        h1, h2, h3 {
            font-weight: 600;
            color: var(--vscode-foreground);
        }

        h1 {
            font-size: 1.5em;
            margin-bottom: 10px;
        }

        h2 {
            font-size: 1.2em;
            margin-top: 20px;
            margin-bottom: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 4px;
        }

        h3 {
            font-size: 1em;
            margin-top: 15px;
            margin-bottom: 5px;
        }

        .spec-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }

        .spec-meta {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
        }

        .behavior {
            background: var(--vscode-editor-inactiveSelectionBackground);
            padding: 12px;
            border-radius: 4px;
            margin-bottom: 10px;
            border-left: 3px solid var(--vscode-activityBarBadge-background);
        }

        .behavior-name {
            font-weight: 600;
            margin-bottom: 5px;
        }

        .behavior-description {
            color: var(--vscode-descriptionForeground);
        }

        .constraint {
            display: flex;
            align-items: center;
            padding: 8px;
            background: var(--vscode-input-background);
            border-radius: 4px;
            margin-bottom: 5px;
        }

        .constraint-icon {
            margin-right: 8px;
        }

        .drift-warning {
            background: var(--vscode-inputValidation-warningBackground);
            border: 1px solid var(--vscode-inputValidation-warningBorder);
            padding: 12px;
            border-radius: 4px;
            margin-bottom: 15px;
        }

        .drift-warning h3 {
            color: var(--vscode-inputValidation-warningForeground);
            margin-top: 0;
        }

        .comparison {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin-top: 10px;
        }

        .comparison-box {
            padding: 10px;
            border-radius: 4px;
        }

        .spec-says {
            background: var(--vscode-diffEditor-insertedTextBackground);
            border: 1px solid var(--vscode-diffEditor-insertedLineBackground);
        }

        .change-says {
            background: var(--vscode-diffEditor-removedTextBackground);
            border: 1px solid var(--vscode-diffEditor-removedLineBackground);
        }

        .comparison-label {
            font-weight: 600;
            font-size: 0.85em;
            margin-bottom: 5px;
            text-transform: uppercase;
        }

        button {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            cursor: pointer;
            font-size: 13px;
        }

        button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .actions {
            display: flex;
            gap: 10px;
            margin-top: 10px;
        }

        .loading {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }

        .no-spec {
            text-align: center;
            padding: 40px;
        }

        .no-spec-icon {
            font-size: 48px;
            margin-bottom: 20px;
        }

        code {
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 4px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
        }

        pre {
            background: var(--vscode-textCodeBlock-background);
            padding: 12px;
            border-radius: 4px;
            overflow-x: auto;
        }
    </style>
</head>
<body>
    <div id="app">
        <div class="loading">
            <p>Select a file to view its behavioral specification</p>
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const app = document.getElementById('app');

        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.type) {
                case 'showSpec':
                    renderSpec(message.spec);
                    break;
                case 'showError':
                    renderError(message.error);
                    break;
            }
        });

        function renderSpec(spec) {
            if (!spec) {
                app.innerHTML = \`
                    <div class="no-spec">
                        <div class="no-spec-icon">📄</div>
                        <h2>No Specification Found</h2>
                        <p>This file doesn't have a behavioral specification yet.</p>
                        <button onclick="generateSpec()">Generate Specification</button>
                    </div>
                \`;
                return;
            }

            let html = \`
                <div class="spec-header">
                    <h1>\${escapeHtml(spec.name || 'Specification')}</h1>
                    <div class="spec-meta">
                        v\${spec.version || 1} • Last updated: \${spec.lastUpdated || 'Unknown'}
                    </div>
                </div>
            \`;

            // Show drift warnings if any
            if (spec.drifts && spec.drifts.length > 0) {
                html += '<h2>⚠️ Drift Detected</h2>';
                for (const drift of spec.drifts) {
                    html += \`
                        <div class="drift-warning">
                            <h3>\${escapeHtml(drift.description)}</h3>
                            <div class="comparison">
                                <div class="comparison-box spec-says">
                                    <div class="comparison-label">Spec Says</div>
                                    <div>\${escapeHtml(drift.specSays)}</div>
                                </div>
                                <div class="comparison-box change-says">
                                    <div class="comparison-label">Code Says</div>
                                    <div>\${escapeHtml(drift.changeSays)}</div>
                                </div>
                            </div>
                            <div class="actions">
                                <button onclick="acknowledgeIntent('\${drift.code}')">Mark as Intended</button>
                                <button class="secondary" onclick="showInEditor('\${drift.line}')">Show in Editor</button>
                            </div>
                        </div>
                    \`;
                }
            }

            // Show behaviors
            if (spec.behaviors && spec.behaviors.length > 0) {
                html += '<h2>Behaviors</h2>';
                for (const behavior of spec.behaviors) {
                    html += \`
                        <div class="behavior">
                            <div class="behavior-name">\${escapeHtml(behavior.name)}</div>
                            <div class="behavior-description">\${escapeHtml(behavior.description)}</div>
                        </div>
                    \`;
                }
            }

            // Show constraints
            if (spec.constraints && spec.constraints.length > 0) {
                html += '<h2>Constraints</h2>';
                for (const constraint of spec.constraints) {
                    const icon = getConstraintIcon(constraint.type);
                    html += \`
                        <div class="constraint">
                            <span class="constraint-icon">\${icon}</span>
                            <span><strong>\${escapeHtml(constraint.name)}:</strong> \${escapeHtml(constraint.value)}</span>
                        </div>
                    \`;
                }
            }

            app.innerHTML = html;
        }

        function renderError(error) {
            app.innerHTML = \`
                <div class="no-spec">
                    <div class="no-spec-icon">❌</div>
                    <h2>Error</h2>
                    <p>\${escapeHtml(error)}</p>
                    <button onclick="refresh()">Retry</button>
                </div>
            \`;
        }

        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function getConstraintIcon(type) {
            switch (type) {
                case 'timeout': return '⏱️';
                case 'retry': return '🔄';
                case 'rate_limit': return '🚦';
                case 'validation': return '✅';
                case 'security': return '🔒';
                default: return '📌';
            }
        }

        function acknowledgeIntent(code) {
            vscode.postMessage({ type: 'acknowledgeIntent', code });
        }

        function showInEditor(line) {
            vscode.postMessage({ type: 'showInEditor', line });
        }

        function generateSpec() {
            vscode.postMessage({ type: 'generateSpec' });
        }

        function refresh() {
            vscode.postMessage({ type: 'refresh' });
        }
    </script>
</body>
</html>`;
    }

    public dispose(): void {
        VoktWebviewPanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}

function getNonce(): string {
    let text = '';
    const possible =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

interface SpecDetails {
    name: string;
    version: number;
    lastUpdated: string;
    behaviors: Array<{
        name: string;
        description: string;
    }>;
    constraints: Array<{
        type: string;
        name: string;
        value: string;
    }>;
    drifts?: Array<{
        code: string;
        description: string;
        specSays: string;
        changeSays: string;
        line: number;
    }>;
}

interface WebviewMessage {
    type: string;
    uri?: string;
    code?: string;
    path?: string;
    line?: number;
}
