import * as assert from 'assert';
import * as vscode from 'vscode';
import { EditBuffer, BufferedEdit } from '../../editBuffer';

suite('EditBuffer Test Suite', () => {
    let editBuffer: EditBuffer;

    setup(() => {
        editBuffer = new EditBuffer(100); // 100ms for faster tests
    });

    teardown(() => {
        editBuffer.dispose();
    });

    test('should buffer edits', () => {
        const mockDocument = createMockDocument('file:///test.ts');
        const mockChanges = createMockChanges();

        editBuffer.addEdit(mockDocument, mockChanges);

        assert.strictEqual(editBuffer.hasBufferedEdits('file:///test.ts'), true);
        assert.strictEqual(editBuffer.getBufferedEditCount('file:///test.ts'), 1);
    });

    test('should return false for hasBufferedEdits when no edits', () => {
        assert.strictEqual(editBuffer.hasBufferedEdits('file:///nonexistent.ts'), false);
    });

    test('should flush edits immediately', () => {
        const mockDocument = createMockDocument('file:///test.ts');
        const mockChanges = createMockChanges();

        editBuffer.addEdit(mockDocument, mockChanges);
        const flushed = editBuffer.flush('file:///test.ts');

        assert.ok(flushed);
        assert.strictEqual(flushed.edits.length, 1);
        assert.strictEqual(editBuffer.hasBufferedEdits('file:///test.ts'), false);
    });

    test('should return undefined when flushing non-existent buffer', () => {
        const flushed = editBuffer.flush('file:///nonexistent.ts');
        assert.strictEqual(flushed, undefined);
    });

    test('should accumulate multiple edits for same document', () => {
        const mockDocument = createMockDocument('file:///test.ts');
        const mockChanges1 = createMockChanges(0, 0);
        const mockChanges2 = createMockChanges(1, 0);

        editBuffer.addEdit(mockDocument, mockChanges1);
        editBuffer.addEdit(mockDocument, mockChanges2);

        assert.strictEqual(editBuffer.getBufferedEditCount('file:///test.ts'), 2);
    });

    test('should call idle callback after timeout', async () => {
        const mockDocument = createMockDocument('file:///test.ts');
        const mockChanges = createMockChanges();

        let callbackCalled = false;
        let receivedUri: string | undefined;
        let receivedEdits: BufferedEdit[] | undefined;

        editBuffer.onIdle((uri, _doc, edits) => {
            callbackCalled = true;
            receivedUri = uri;
            receivedEdits = edits;
        });

        editBuffer.addEdit(mockDocument, mockChanges);

        // Wait for idle timeout (100ms + buffer)
        await new Promise((resolve) => setTimeout(resolve, 150));

        assert.strictEqual(callbackCalled, true);
        assert.strictEqual(receivedUri, 'file:///test.ts');
        assert.ok(receivedEdits);
        assert.strictEqual(receivedEdits.length, 1);
    });

    test('should reset timer on new edit', async () => {
        const mockDocument = createMockDocument('file:///test.ts');
        const mockChanges = createMockChanges();

        let callbackCount = 0;

        editBuffer.onIdle(() => {
            callbackCount++;
        });

        editBuffer.addEdit(mockDocument, mockChanges);

        // Wait 50ms, then add another edit
        await new Promise((resolve) => setTimeout(resolve, 50));
        editBuffer.addEdit(mockDocument, createMockChanges(1, 0));

        // Wait 50ms more - callback should not have fired yet
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.strictEqual(callbackCount, 0);

        // Wait for full timeout
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.strictEqual(callbackCount, 1);
    });

    test('should calculate combined range correctly', () => {
        const edits: BufferedEdit[] = [
            {
                changes: [createMockChangeEvent(1, 0, 1, 5)],
                timestamp: Date.now(),
                version: 1,
            },
            {
                changes: [createMockChangeEvent(3, 2, 4, 10)],
                timestamp: Date.now(),
                version: 2,
            },
        ];

        const range = editBuffer.getCombinedRange(edits);

        assert.strictEqual(range.start.line, 1);
        assert.strictEqual(range.start.character, 0);
        assert.strictEqual(range.end.line, 4);
        assert.strictEqual(range.end.character, 10);
    });

    test('should return empty range for empty edits array', () => {
        const range = editBuffer.getCombinedRange([]);

        assert.strictEqual(range.start.line, 0);
        assert.strictEqual(range.start.character, 0);
        assert.strictEqual(range.end.line, 0);
        assert.strictEqual(range.end.character, 0);
    });

    test('should flush all documents', () => {
        const mockDoc1 = createMockDocument('file:///test1.ts');
        const mockDoc2 = createMockDocument('file:///test2.ts');

        editBuffer.addEdit(mockDoc1, createMockChanges());
        editBuffer.addEdit(mockDoc2, createMockChanges());

        const flushed = editBuffer.flushAll();

        assert.strictEqual(flushed.size, 2);
        assert.ok(flushed.has('file:///test1.ts'));
        assert.ok(flushed.has('file:///test2.ts'));
        assert.strictEqual(editBuffer.hasBufferedEdits('file:///test1.ts'), false);
        assert.strictEqual(editBuffer.hasBufferedEdits('file:///test2.ts'), false);
    });

    test('should handle error in idle callback gracefully', async () => {
        const mockDocument = createMockDocument('file:///test.ts');
        const mockChanges = createMockChanges();

        editBuffer.onIdle(() => {
            throw new Error('Test error');
        });

        editBuffer.addEdit(mockDocument, mockChanges);

        // Wait for idle timeout - should not throw
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Test passes if no unhandled exception
        assert.ok(true);
    });
});

// Helper functions to create mock objects

function createMockDocument(uri: string): vscode.TextDocument {
    return {
        uri: vscode.Uri.parse(uri),
        version: 1,
        getText: () => '',
        lineAt: () => ({ text: '' }),
        fileName: uri,
        languageId: 'typescript',
    } as unknown as vscode.TextDocument;
}

function createMockChanges(
    startLine: number = 0,
    startChar: number = 0
): readonly vscode.TextDocumentContentChangeEvent[] {
    return [createMockChangeEvent(startLine, startChar, startLine, startChar + 1)];
}

function createMockChangeEvent(
    startLine: number,
    startChar: number,
    endLine: number,
    endChar: number
): vscode.TextDocumentContentChangeEvent {
    return {
        range: new vscode.Range(startLine, startChar, endLine, endChar),
        rangeOffset: 0,
        rangeLength: 0,
        text: 'x',
    };
}
