import * as assert from 'assert';
import * as vscode from 'vscode';
import { ChangeFilter } from '../../changeFilter';

suite('ChangeFilter Test Suite', () => {
    let filter: ChangeFilter;

    setup(() => {
        filter = new ChangeFilter();
    });

    suite('Whitespace Detection', () => {
        test('should classify whitespace-only changes as non-significant', () => {
            const doc = createMockDocument('typescript', '  \n\n  ');
            const changes = [createChange(0, 0, 0, 0, '  ')];

            const result = filter.classify(doc, changes);

            assert.strictEqual(result.changeType, 'whitespace');
            assert.strictEqual(result.isSignificant, false);
        });

        test('should classify empty changes as whitespace', () => {
            const doc = createMockDocument('typescript', '');
            const changes: vscode.TextDocumentContentChangeEvent[] = [];

            const result = filter.classify(doc, changes);

            assert.strictEqual(result.changeType, 'whitespace');
            assert.strictEqual(result.isSignificant, false);
        });
    });

    suite('Code Changes', () => {
        test('should classify code changes as significant', () => {
            const doc = createMockDocument('typescript', 'const x = 1;');
            const changes = [createChange(0, 0, 0, 0, 'const y = 2;')];

            const result = filter.classify(doc, changes);

            assert.strictEqual(result.changeType, 'code');
            assert.strictEqual(result.isSignificant, true);
        });

        test('should classify function changes as code', () => {
            const doc = createMockDocument('typescript', 'function foo() {}');
            const changes = [createChange(0, 0, 0, 0, 'function bar() {}')];

            const result = filter.classify(doc, changes);

            assert.strictEqual(result.isSignificant, true);
        });
    });

    suite('Comment Detection', () => {
        test('should classify line comment changes in TypeScript as comment', () => {
            const doc = createMockDocument('typescript', '// this is a comment');
            const changes = [createChange(0, 0, 0, 20, '// updated comment')];

            const result = filter.classify(doc, changes);

            assert.strictEqual(result.changeType, 'comment');
        });

        test('should classify line comment changes in Python as comment', () => {
            const doc = createMockDocument('python', '# this is a comment');
            const changes = [createChange(0, 0, 0, 19, '# updated comment')];

            const result = filter.classify(doc, changes);

            assert.strictEqual(result.changeType, 'comment');
        });

        test('should classify line comment changes in Go as comment', () => {
            const doc = createMockDocument('go', '// this is a comment');
            const changes = [createChange(0, 0, 0, 20, '// updated comment')];

            const result = filter.classify(doc, changes);

            assert.strictEqual(result.changeType, 'comment');
        });
    });

    suite('Configuration', () => {
        test('should respect ignoreComments = false', () => {
            const customFilter = new ChangeFilter({
                ignoreComments: false,
                ignoreWhitespace: true,
                ignoreFormatting: true,
            });

            const doc = createMockDocument('typescript', '// comment');
            const changes = [createChange(0, 0, 0, 10, '// new comment')];

            const result = customFilter.classify(doc, changes);

            // Even though it's a comment, it should be significant
            assert.strictEqual(result.isSignificant, true);
        });

        test('should update configuration', () => {
            filter.updateConfig({ ignoreWhitespace: false });

            const doc = createMockDocument('typescript', '  ');
            const changes = [createChange(0, 0, 0, 0, '    ')];

            const result = filter.classify(doc, changes);

            // Whitespace should now be significant
            assert.strictEqual(result.isSignificant, true);
        });
    });

    suite('Mixed Changes', () => {
        test('should classify mixed code and whitespace as mixed/significant', () => {
            const doc = createMockDocument('typescript', 'const x = 1;');
            const changes = [
                createChange(0, 0, 0, 0, 'const y = 2;'),
                createChange(1, 0, 1, 0, '  '),
            ];

            const result = filter.classify(doc, changes);

            assert.strictEqual(result.isSignificant, true);
        });
    });

    suite('Range Calculation', () => {
        test('should calculate combined range for multiple changes', () => {
            const doc = createMockDocument('typescript', 'line1\nline2\nline3');
            const changes = [
                createChange(0, 0, 0, 5, 'new1'),
                createChange(2, 0, 2, 5, 'new3'),
            ];

            const result = filter.classify(doc, changes);

            assert.strictEqual(result.affectedRange.start.line, 0);
            assert.strictEqual(result.affectedRange.end.line, 2);
        });
    });
});

// Helper functions

function createMockDocument(languageId: string, content: string): vscode.TextDocument {
    const lines = content.split('\n');
    return {
        languageId,
        getText: (range?: vscode.Range) => {
            if (!range) {
                return content;
            }
            // Simplified getText for testing
            return content.substring(0, range.end.character);
        },
        lineAt: (line: number) => ({
            text: lines[line] || '',
            range: new vscode.Range(line, 0, line, (lines[line] || '').length),
        }),
        uri: vscode.Uri.parse('file:///test.ts'),
        fileName: '/test.ts',
        version: 1,
    } as unknown as vscode.TextDocument;
}

function createChange(
    startLine: number,
    startChar: number,
    endLine: number,
    endChar: number,
    text: string
): vscode.TextDocumentContentChangeEvent {
    return {
        range: new vscode.Range(startLine, startChar, endLine, endChar),
        rangeOffset: 0,
        rangeLength: endChar - startChar,
        text,
    };
}
