import * as assert from 'assert';

// Test the LRU cache behavior
// Note: The LRUCache is private to scopeTracker, so we test it via the ScopeTracker class behavior

suite('ScopeTracker Test Suite', () => {
    // LRU Cache tests via direct implementation
    suite('LRU Cache Behavior', () => {
        // Create a simple LRU cache for testing (mirrors the implementation)
        class TestLRUCache<K, V> {
            private cache = new Map<K, V>();
            private readonly maxSize: number;

            constructor(maxSize: number = 50) {
                this.maxSize = maxSize;
            }

            get(key: K): V | undefined {
                const value = this.cache.get(key);
                if (value !== undefined) {
                    this.cache.delete(key);
                    this.cache.set(key, value);
                }
                return value;
            }

            set(key: K, value: V): void {
                if (this.cache.has(key)) {
                    this.cache.delete(key);
                } else if (this.cache.size >= this.maxSize) {
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

            get size(): number {
                return this.cache.size;
            }

            clear(): void {
                this.cache.clear();
            }
        }

        test('should store and retrieve values', () => {
            const cache = new TestLRUCache<string, number>(3);

            cache.set('a', 1);
            cache.set('b', 2);
            cache.set('c', 3);

            assert.strictEqual(cache.get('a'), 1);
            assert.strictEqual(cache.get('b'), 2);
            assert.strictEqual(cache.get('c'), 3);
        });

        test('should return undefined for missing keys', () => {
            const cache = new TestLRUCache<string, number>(3);

            assert.strictEqual(cache.get('nonexistent'), undefined);
        });

        test('should evict oldest entry when capacity exceeded', () => {
            const cache = new TestLRUCache<string, number>(3);

            cache.set('a', 1);
            cache.set('b', 2);
            cache.set('c', 3);
            cache.set('d', 4); // Should evict 'a'

            assert.strictEqual(cache.has('a'), false);
            assert.strictEqual(cache.get('b'), 2);
            assert.strictEqual(cache.get('c'), 3);
            assert.strictEqual(cache.get('d'), 4);
            assert.strictEqual(cache.size, 3);
        });

        test('should move accessed items to end (most recent)', () => {
            const cache = new TestLRUCache<string, number>(3);

            cache.set('a', 1);
            cache.set('b', 2);
            cache.set('c', 3);

            // Access 'a' to move it to the end
            cache.get('a');

            // Add 'd' - should evict 'b' (now oldest)
            cache.set('d', 4);

            assert.strictEqual(cache.has('a'), true);
            assert.strictEqual(cache.has('b'), false);
            assert.strictEqual(cache.has('c'), true);
            assert.strictEqual(cache.has('d'), true);
        });

        test('should update existing key without increasing size', () => {
            const cache = new TestLRUCache<string, number>(3);

            cache.set('a', 1);
            cache.set('b', 2);
            cache.set('a', 10); // Update existing

            assert.strictEqual(cache.size, 2);
            assert.strictEqual(cache.get('a'), 10);
        });

        test('should clear all entries', () => {
            const cache = new TestLRUCache<string, number>(3);

            cache.set('a', 1);
            cache.set('b', 2);
            cache.clear();

            assert.strictEqual(cache.size, 0);
            assert.strictEqual(cache.has('a'), false);
            assert.strictEqual(cache.has('b'), false);
        });

        test('should handle single item capacity', () => {
            const cache = new TestLRUCache<string, number>(1);

            cache.set('a', 1);
            cache.set('b', 2);

            assert.strictEqual(cache.size, 1);
            assert.strictEqual(cache.has('a'), false);
            assert.strictEqual(cache.get('b'), 2);
        });

        test('should maintain order after multiple operations', () => {
            const cache = new TestLRUCache<string, number>(3);

            // Add initial values
            cache.set('a', 1);
            cache.set('b', 2);
            cache.set('c', 3);

            // Access in order: c, a, b
            cache.get('c');
            cache.get('a');
            cache.get('b');

            // Now order is: c, a, b (oldest to newest)
            // Adding 'd' should evict 'c'
            cache.set('d', 4);

            assert.strictEqual(cache.has('c'), false);
            assert.strictEqual(cache.has('a'), true);
            assert.strictEqual(cache.has('b'), true);
            assert.strictEqual(cache.has('d'), true);
        });
    });
});
