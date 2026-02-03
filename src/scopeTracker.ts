import * as vscode from 'vscode';

export interface EditScope {
    name: string;
    kind: 'function' | 'method' | 'class' | 'module' | 'unknown';
    className?: string;
    range: vscode.Range;
    symbolKind: vscode.SymbolKind;
}

/**
 * LRU (Least Recently Used) cache with configurable max size.
 * Evicts oldest entries when capacity is reached.
 */
class LRUCache<K, V> {
    private cache = new Map<K, V>();
    private readonly maxSize: number;

    constructor(maxSize: number = 50) {
        this.maxSize = maxSize;
    }

    get(key: K): V | undefined {
        const value = this.cache.get(key);
        if (value !== undefined) {
            // Move to end (most recently used)
            this.cache.delete(key);
            this.cache.set(key, value);
        }
        return value;
    }

    set(key: K, value: V): void {
        // If key exists, delete first to update position
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // Delete oldest (first) entry
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }
        this.cache.set(key, value);
    }

    has(key: K): boolean {
        return this.cache.has(key);
    }

    delete(key: K): boolean {
        return this.cache.delete(key);
    }

    clear(): void {
        this.cache.clear();
    }

    get size(): number {
        return this.cache.size;
    }
}

// Default cache size - can hold symbols for 50 open files
const DEFAULT_SYMBOL_CACHE_SIZE = 50;

export class ScopeTracker {
    // LRU cache for document symbols to avoid repeated lookups and memory leaks
    private symbolCache: LRUCache<string, { symbols: vscode.DocumentSymbol[]; version: number }>;

    constructor(cacheSize: number = DEFAULT_SYMBOL_CACHE_SIZE) {
        this.symbolCache = new LRUCache(cacheSize);
    }

    async getEnclosingScope(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<EditScope | undefined> {
        const symbols = await this.getDocumentSymbols(document);

        if (!symbols || symbols.length === 0) {
            return undefined;
        }

        const enclosing = this.findEnclosingSymbol(symbols, position);

        if (!enclosing) {
            return undefined;
        }

        return this.symbolToEditScope(enclosing, symbols);
    }

    async getEnclosingScopeForRange(
        document: vscode.TextDocument,
        range: vscode.Range
    ): Promise<EditScope | undefined> {
        // Find the scope that contains the entire range
        const symbols = await this.getDocumentSymbols(document);

        if (!symbols || symbols.length === 0) {
            return undefined;
        }

        const enclosing = this.findEnclosingSymbolForRange(symbols, range);

        if (!enclosing) {
            return undefined;
        }

        return this.symbolToEditScope(enclosing, symbols);
    }

    private async getDocumentSymbols(
        document: vscode.TextDocument
    ): Promise<vscode.DocumentSymbol[] | undefined> {
        const uri = document.uri.toString();
        const cached = this.symbolCache.get(uri);

        // Return cached if version matches
        if (cached && cached.version === document.version) {
            return cached.symbols;
        }

        try {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                document.uri
            );

            if (symbols) {
                this.symbolCache.set(uri, { symbols, version: document.version });
            }

            return symbols;
        } catch {
            return undefined;
        }
    }

    private findEnclosingSymbol(
        symbols: vscode.DocumentSymbol[],
        position: vscode.Position
    ): vscode.DocumentSymbol | undefined {
        for (const symbol of symbols) {
            if (symbol.range.contains(position)) {
                // Check children first (more specific scope)
                if (symbol.children && symbol.children.length > 0) {
                    const childMatch = this.findEnclosingSymbol(symbol.children, position);
                    if (childMatch) {
                        return childMatch;
                    }
                }

                // Return this symbol if it's a function/method/class
                if (this.isRelevantSymbol(symbol)) {
                    return symbol;
                }
            }
        }

        return undefined;
    }

    private findEnclosingSymbolForRange(
        symbols: vscode.DocumentSymbol[],
        range: vscode.Range
    ): vscode.DocumentSymbol | undefined {
        for (const symbol of symbols) {
            // Check if symbol contains the entire range
            if (symbol.range.contains(range)) {
                // Check children first (more specific scope)
                if (symbol.children && symbol.children.length > 0) {
                    const childMatch = this.findEnclosingSymbolForRange(symbol.children, range);
                    if (childMatch) {
                        return childMatch;
                    }
                }

                // Return this symbol if it's a function/method/class
                if (this.isRelevantSymbol(symbol)) {
                    return symbol;
                }
            }
        }

        return undefined;
    }

    private isRelevantSymbol(symbol: vscode.DocumentSymbol): boolean {
        return [
            vscode.SymbolKind.Function,
            vscode.SymbolKind.Method,
            vscode.SymbolKind.Class,
            vscode.SymbolKind.Constructor,
            vscode.SymbolKind.Module,
            vscode.SymbolKind.Namespace,
            vscode.SymbolKind.Interface,
            vscode.SymbolKind.Struct,
        ].includes(symbol.kind);
    }

    private symbolToEditScope(
        symbol: vscode.DocumentSymbol,
        allSymbols: vscode.DocumentSymbol[]
    ): EditScope {
        const kind = this.mapSymbolKind(symbol.kind);
        let className: string | undefined;

        // If it's a method, find the parent class
        if (kind === 'method') {
            className = this.findParentClassName(symbol, allSymbols);
        }

        return {
            name: symbol.name,
            kind,
            className,
            range: symbol.range,
            symbolKind: symbol.kind,
        };
    }

    private mapSymbolKind(kind: vscode.SymbolKind): EditScope['kind'] {
        switch (kind) {
            case vscode.SymbolKind.Function:
                return 'function';
            case vscode.SymbolKind.Method:
            case vscode.SymbolKind.Constructor:
                return 'method';
            case vscode.SymbolKind.Class:
            case vscode.SymbolKind.Struct:
            case vscode.SymbolKind.Interface:
                return 'class';
            case vscode.SymbolKind.Module:
            case vscode.SymbolKind.Namespace:
                return 'module';
            default:
                return 'unknown';
        }
    }

    private findParentClassName(
        method: vscode.DocumentSymbol,
        symbols: vscode.DocumentSymbol[]
    ): string | undefined {
        for (const symbol of symbols) {
            if (this.isClassLike(symbol) && symbol.range.contains(method.range)) {
                return symbol.name;
            }

            // Check nested classes
            if (symbol.children && symbol.children.length > 0) {
                const nested = this.findParentClassName(method, symbol.children);
                if (nested) {
                    return nested;
                }
            }
        }

        return undefined;
    }

    private isClassLike(symbol: vscode.DocumentSymbol): boolean {
        return [
            vscode.SymbolKind.Class,
            vscode.SymbolKind.Struct,
            vscode.SymbolKind.Interface,
        ].includes(symbol.kind);
    }

    clearCache(uri?: string): void {
        if (uri) {
            this.symbolCache.delete(uri);
        } else {
            this.symbolCache.clear();
        }
    }
}
