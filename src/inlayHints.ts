import * as vscode from 'vscode';
import { getClient } from './client';

export class VoktInlayHintsProvider implements vscode.InlayHintsProvider {
    private onDidChangeInlayHintsEmitter = new vscode.EventEmitter<void>();
    readonly onDidChangeInlayHints = this.onDidChangeInlayHintsEmitter.event;

    async provideInlayHints(
        document: vscode.TextDocument,
        range: vscode.Range,
        token: vscode.CancellationToken
    ): Promise<vscode.InlayHint[]> {
        const client = getClient();
        if (!client || !client.isRunning()) {
            return [];
        }

        try {
            const response = await client.sendRequest<InlayHintsResponse>(
                'vokt/inlayHints',
                {
                    uri: document.uri.toString(),
                    range: {
                        start: { line: range.start.line, character: range.start.character },
                        end: { line: range.end.line, character: range.end.character },
                    },
                },
                token
            );

            if (!response || !response.hints) {
                return [];
            }

            return response.hints.map((hint) => this.convertHint(hint));
        } catch {
            // Return empty array on error (e.g., if server doesn't support this request)
            return [];
        }
    }

    private convertHint(hint: ServerInlayHint): vscode.InlayHint {
        const position = new vscode.Position(hint.position.line, hint.position.character);

        let inlayHint: vscode.InlayHint;

        if (hint.kind === 'type') {
            inlayHint = new vscode.InlayHint(position, hint.label, vscode.InlayHintKind.Type);
        } else if (hint.kind === 'parameter') {
            inlayHint = new vscode.InlayHint(position, hint.label, vscode.InlayHintKind.Parameter);
        } else {
            // For behavioral constraints, use a custom label part
            const labelPart: vscode.InlayHintLabelPart = {
                value: hint.label,
                tooltip: hint.tooltip
                    ? new vscode.MarkdownString(hint.tooltip)
                    : undefined,
            };

            if (hint.command) {
                labelPart.command = {
                    title: hint.command.title,
                    command: hint.command.command,
                    arguments: hint.command.arguments,
                };
            }

            inlayHint = new vscode.InlayHint(position, [labelPart]);
        }

        // Style the hint
        if (hint.paddingLeft !== undefined) {
            inlayHint.paddingLeft = hint.paddingLeft;
        }
        if (hint.paddingRight !== undefined) {
            inlayHint.paddingRight = hint.paddingRight;
        }

        return inlayHint;
    }

    refresh(): void {
        this.onDidChangeInlayHintsEmitter.fire();
    }
}

interface InlayHintsResponse {
    hints: ServerInlayHint[];
}

interface ServerInlayHint {
    position: {
        line: number;
        character: number;
    };
    label: string;
    kind?: 'type' | 'parameter' | 'constraint' | 'behavior';
    tooltip?: string;
    paddingLeft?: boolean;
    paddingRight?: boolean;
    command?: {
        title: string;
        command: string;
        arguments?: unknown[];
    };
}

export function createBehavioralConstraintHint(
    line: number,
    character: number,
    constraintName: string,
    constraintValue: string
): vscode.InlayHint {
    const position = new vscode.Position(line, character);

    const label: vscode.InlayHintLabelPart = {
        value: `[${constraintName}: ${constraintValue}]`,
        tooltip: new vscode.MarkdownString(
            `**Behavioral Constraint**\n\n` +
            `This code has a behavioral specification:\n\n` +
            `- **${constraintName}**: ${constraintValue}\n\n` +
            `Modifying this behavior may trigger a drift warning.`
        ),
        command: {
            title: 'Show Specification',
            command: 'vokt.showSpec',
        },
    };

    const hint = new vscode.InlayHint(position, [label]);
    hint.paddingLeft = true;
    hint.paddingRight = true;

    return hint;
}

export function createRetryBehaviorHint(
    line: number,
    character: number,
    retryCount: number | 'unlimited',
    backoffStrategy: string
): vscode.InlayHint {
    const position = new vscode.Position(line, character);

    const label: vscode.InlayHintLabelPart = {
        value: `[retry: ${retryCount}, ${backoffStrategy}]`,
        tooltip: new vscode.MarkdownString(
            `**Retry Behavior**\n\n` +
            `- **Max retries**: ${retryCount}\n` +
            `- **Backoff**: ${backoffStrategy}\n\n` +
            `This is a specified behavior. Changes will be flagged.`
        ),
    };

    const hint = new vscode.InlayHint(position, [label]);
    hint.paddingLeft = true;

    return hint;
}

export function createTimeoutHint(
    line: number,
    character: number,
    timeoutMs: number
): vscode.InlayHint {
    const position = new vscode.Position(line, character);

    const formattedTimeout =
        timeoutMs >= 1000 ? `${timeoutMs / 1000}s` : `${timeoutMs}ms`;

    const label: vscode.InlayHintLabelPart = {
        value: `[timeout: ${formattedTimeout}]`,
        tooltip: new vscode.MarkdownString(
            `**Timeout Constraint**\n\n` +
            `This operation must complete within **${formattedTimeout}**.\n\n` +
            `Specified in behavioral spec.`
        ),
    };

    const hint = new vscode.InlayHint(position, [label]);
    hint.paddingLeft = true;

    return hint;
}
