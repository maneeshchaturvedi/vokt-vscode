import * as vscode from 'vscode';

export interface ChangeClassification {
    isSignificant: boolean;
    changeType: 'code' | 'comment' | 'whitespace' | 'formatting' | 'mixed';
    affectedRange: vscode.Range;
}

export interface FilterConfig {
    ignoreComments: boolean;
    ignoreWhitespace: boolean;
    ignoreFormatting: boolean;
}

const DEFAULT_CONFIG: FilterConfig = {
    ignoreComments: true,
    ignoreWhitespace: true,
    ignoreFormatting: true,
};

// Comment patterns per language
const COMMENT_PATTERNS: Record<string, { line: RegExp; blockStart: RegExp; blockEnd: RegExp }> = {
    go: {
        line: /^\s*\/\//,
        blockStart: /\/\*/,
        blockEnd: /\*\//,
    },
    javascript: {
        line: /^\s*\/\//,
        blockStart: /\/\*/,
        blockEnd: /\*\//,
    },
    typescript: {
        line: /^\s*\/\//,
        blockStart: /\/\*/,
        blockEnd: /\*\//,
    },
    python: {
        line: /^\s*#/,
        blockStart: /^(\s*"""|\s*''')/,
        blockEnd: /("""|''')\s*$/,
    },
    java: {
        line: /^\s*\/\//,
        blockStart: /\/\*/,
        blockEnd: /\*\//,
    },
    rust: {
        line: /^\s*\/\//,
        blockStart: /\/\*/,
        blockEnd: /\*\//,
    },
    c: {
        line: /^\s*\/\//,
        blockStart: /\/\*/,
        blockEnd: /\*\//,
    },
    cpp: {
        line: /^\s*\/\//,
        blockStart: /\/\*/,
        blockEnd: /\*\//,
    },
};

export class ChangeFilter {
    private config: FilterConfig;

    constructor(config: Partial<FilterConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    updateConfig(config: Partial<FilterConfig>): void {
        this.config = { ...this.config, ...config };
    }

    classify(
        document: vscode.TextDocument,
        changes: readonly vscode.TextDocumentContentChangeEvent[]
    ): ChangeClassification {
        if (changes.length === 0) {
            return {
                isSignificant: false,
                changeType: 'whitespace',
                affectedRange: new vscode.Range(0, 0, 0, 0),
            };
        }

        // Combine all change ranges
        const affectedRange = this.getCombinedRange(changes);

        // Classify each change
        const classifications = changes.map((change) =>
            this.classifySingleChange(document, change)
        );

        // Determine overall classification
        const hasCode = classifications.some((c) => c === 'code');
        const hasComment = classifications.some((c) => c === 'comment');
        const hasWhitespace = classifications.some((c) => c === 'whitespace');
        const hasFormatting = classifications.some((c) => c === 'formatting');

        let changeType: ChangeClassification['changeType'];
        let isSignificant: boolean;

        if (hasCode) {
            changeType = hasComment || hasWhitespace ? 'mixed' : 'code';
            isSignificant = true;
        } else if (hasComment && !hasWhitespace && !hasFormatting) {
            changeType = 'comment';
            isSignificant = !this.config.ignoreComments;
        } else if (hasWhitespace && !hasComment && !hasFormatting) {
            changeType = 'whitespace';
            isSignificant = !this.config.ignoreWhitespace;
        } else if (hasFormatting) {
            changeType = 'formatting';
            isSignificant = !this.config.ignoreFormatting;
        } else {
            changeType = 'mixed';
            isSignificant = true;
        }

        return {
            isSignificant,
            changeType,
            affectedRange,
        };
    }

    private classifySingleChange(
        document: vscode.TextDocument,
        change: vscode.TextDocumentContentChangeEvent
    ): 'code' | 'comment' | 'whitespace' | 'formatting' {
        const newText = change.text;
        const range = change.range;

        // Get the old text that was replaced
        const oldText = this.getOldText(document, range, change.rangeLength);

        // Check whitespace-only
        if (this.isWhitespaceOnly(oldText, newText)) {
            return 'whitespace';
        }

        // Check formatting-only (same non-whitespace content)
        if (this.isFormattingOnly(oldText, newText)) {
            return 'formatting';
        }

        // Check if change is within a comment
        if (this.isInComment(document, range)) {
            return 'comment';
        }

        // Check if the new text is comment-only
        if (this.isCommentText(document.languageId, newText)) {
            return 'comment';
        }

        return 'code';
    }

    private getOldText(
        document: vscode.TextDocument,
        range: vscode.Range,
        _rangeLength: number
    ): string {
        // The range represents what was in the document before the change
        // We can't get the actual old text after the change happened,
        // but we can infer from the range
        try {
            // This won't work after the change, but we can check the range size
            return document.getText(range);
        } catch {
            return '';
        }
    }

    private isWhitespaceOnly(oldText: string, newText: string): boolean {
        const oldTrimmed = oldText.trim();
        const newTrimmed = newText.trim();

        // Both are empty or whitespace-only
        if (oldTrimmed === '' && newTrimmed === '') {
            return true;
        }

        // One has content, the other doesn't
        if (oldTrimmed === '' || newTrimmed === '') {
            // Adding/removing only whitespace
            return oldTrimmed === '' && newTrimmed === '';
        }

        return false;
    }

    private isFormattingOnly(oldText: string, newText: string): boolean {
        // Remove all whitespace and compare
        const oldNormalized = oldText.replace(/\s+/g, '');
        const newNormalized = newText.replace(/\s+/g, '');

        return oldNormalized === newNormalized && oldText !== newText;
    }

    private isInComment(document: vscode.TextDocument, range: vscode.Range): boolean {
        const languageId = document.languageId;
        const patterns = COMMENT_PATTERNS[languageId];

        if (!patterns) {
            return false;
        }

        // Check if the line is a line comment
        const line = document.lineAt(range.start.line);
        if (patterns.line.test(line.text)) {
            return true;
        }

        // Check if we're inside a block comment
        // Look backwards for block comment start
        for (let i = range.start.line; i >= 0; i--) {
            const lineText = document.lineAt(i).text;

            // If we find block end before block start, we're not in a comment
            if (i < range.start.line && patterns.blockEnd.test(lineText)) {
                return false;
            }

            // If we find block start, check if it's closed before our position
            if (patterns.blockStart.test(lineText)) {
                // Check if the block is closed on the same line or before our range
                const afterStart = lineText.substring(lineText.search(patterns.blockStart));
                if (!patterns.blockEnd.test(afterStart)) {
                    // Block comment started but not closed on same line
                    // Check if it's closed before our position
                    for (let j = i + 1; j <= range.start.line; j++) {
                        if (patterns.blockEnd.test(document.lineAt(j).text)) {
                            return false;
                        }
                    }
                    return true;
                }
            }
        }

        return false;
    }

    private isCommentText(languageId: string, text: string): boolean {
        const patterns = COMMENT_PATTERNS[languageId];
        if (!patterns) {
            return false;
        }

        const trimmed = text.trim();
        if (trimmed === '') {
            return false;
        }

        // Check if it's a line comment
        if (patterns.line.test(trimmed)) {
            return true;
        }

        // Check if it's a complete block comment
        if (patterns.blockStart.test(trimmed) && patterns.blockEnd.test(trimmed)) {
            return true;
        }

        return false;
    }

    private getCombinedRange(
        changes: readonly vscode.TextDocumentContentChangeEvent[]
    ): vscode.Range {
        if (changes.length === 0) {
            return new vscode.Range(0, 0, 0, 0);
        }

        let startLine = changes[0].range.start.line;
        let startChar = changes[0].range.start.character;
        let endLine = changes[0].range.end.line;
        let endChar = changes[0].range.end.character;

        for (const change of changes) {
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

        return new vscode.Range(startLine, startChar, endLine, endChar);
    }
}
