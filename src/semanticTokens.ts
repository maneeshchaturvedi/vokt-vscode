import * as vscode from 'vscode';
import { getClient } from './client';

// Define token types and modifiers
const tokenTypes = ['constraint', 'drift', 'behavior', 'spec'];
const tokenModifiers = ['behavioral', 'modified', 'deprecated'];

export const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);

export class VoktSemanticTokensProvider
    implements vscode.DocumentSemanticTokensProvider
{
    private onDidChangeSemanticTokensEmitter = new vscode.EventEmitter<void>();
    readonly onDidChangeSemanticTokens = this.onDidChangeSemanticTokensEmitter.event;

    async provideDocumentSemanticTokens(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.SemanticTokens | null> {
        const client = getClient();
        if (!client || !client.isRunning()) {
            return null;
        }

        try {
            const response = await client.sendRequest<SemanticTokensResponse>(
                'vokt/semanticTokens',
                {
                    uri: document.uri.toString(),
                },
                token
            );

            if (!response || !response.tokens || response.tokens.length === 0) {
                return null;
            }

            const builder = new vscode.SemanticTokensBuilder(legend);

            for (const t of response.tokens) {
                const tokenType = tokenTypes.indexOf(t.type);
                if (tokenType === -1) {
                    continue;
                }

                let tokenModifierBits = 0;
                if (t.modifiers) {
                    for (const mod of t.modifiers) {
                        const modIndex = tokenModifiers.indexOf(mod);
                        if (modIndex !== -1) {
                            tokenModifierBits |= 1 << modIndex;
                        }
                    }
                }

                builder.push(
                    t.line,
                    t.startChar,
                    t.length,
                    tokenType,
                    tokenModifierBits
                );
            }

            return builder.build();
        } catch {
            // Return null on error (server may not support this)
            return null;
        }
    }

    refresh(): void {
        this.onDidChangeSemanticTokensEmitter.fire();
    }
}

interface SemanticTokensResponse {
    tokens: Array<{
        line: number;
        startChar: number;
        length: number;
        type: string;
        modifiers?: string[];
    }>;
}

export class VoktSemanticTokensRangeProvider
    implements vscode.DocumentRangeSemanticTokensProvider
{
    async provideDocumentRangeSemanticTokens(
        document: vscode.TextDocument,
        range: vscode.Range,
        token: vscode.CancellationToken
    ): Promise<vscode.SemanticTokens | null> {
        const client = getClient();
        if (!client || !client.isRunning()) {
            return null;
        }

        try {
            const response = await client.sendRequest<SemanticTokensResponse>(
                'vokt/semanticTokensRange',
                {
                    uri: document.uri.toString(),
                    range: {
                        start: { line: range.start.line, character: range.start.character },
                        end: { line: range.end.line, character: range.end.character },
                    },
                },
                token
            );

            if (!response || !response.tokens || response.tokens.length === 0) {
                return null;
            }

            const builder = new vscode.SemanticTokensBuilder(legend);

            for (const t of response.tokens) {
                const tokenType = tokenTypes.indexOf(t.type);
                if (tokenType === -1) {
                    continue;
                }

                let tokenModifierBits = 0;
                if (t.modifiers) {
                    for (const mod of t.modifiers) {
                        const modIndex = tokenModifiers.indexOf(mod);
                        if (modIndex !== -1) {
                            tokenModifierBits |= 1 << modIndex;
                        }
                    }
                }

                builder.push(
                    t.line,
                    t.startChar,
                    t.length,
                    tokenType,
                    tokenModifierBits
                );
            }

            return builder.build();
        } catch {
            return null;
        }
    }
}

export function getSemanticTokenColorCustomizations(): Record<string, string> {
    return {
        'voktConstraint': '#4EC9B0',
        'voktDrift': '#FF9900',
        'voktBehavior': '#569CD6',
        'voktSpec': '#C586C0',
    };
}
