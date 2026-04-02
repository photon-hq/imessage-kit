import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

describe('TempFileManager destroy flow', () => {
    it('should clean temp files before marking the manager destroyed', () => {
        const source = readFileSync(new URL('../src/utils/temp-file-manager.ts', import.meta.url), 'utf-8')

        const destroyStart = source.indexOf('async destroy(): Promise<void> {')
        const stopIndex = source.indexOf('this.stop()', destroyStart)
        const cleanupIndex = source.indexOf('await this.cleanupAll()', destroyStart)
        const destroyedIndex = source.indexOf('this.isDestroyed = true', destroyStart)

        expect(destroyStart).toBeGreaterThanOrEqual(0)
        expect(stopIndex).toBeGreaterThan(destroyStart)
        expect(cleanupIndex).toBeGreaterThan(stopIndex)
        expect(destroyedIndex).toBeGreaterThan(cleanupIndex)
    })
})
