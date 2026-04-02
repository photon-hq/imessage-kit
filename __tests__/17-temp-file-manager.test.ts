import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { TempFileManager } from '../src/utils/temp-file-manager'

describe('TempFileManager destroy flow', () => {
    it('should clean temp files before marking the manager destroyed', () => {
        const source = readFileSync(new URL('../src/utils/temp-file-manager.ts', import.meta.url), 'utf-8')

        const destroyMatch = source.match(/async\s+destroy\s*\(\s*\)\s*:\s*Promise<void>\s*\{/)
        const destroyStart = destroyMatch?.index ?? -1

        expect(destroyStart).toBeGreaterThanOrEqual(0)

        const bodyStart = source.indexOf('{', destroyStart)
        expect(bodyStart).toBeGreaterThanOrEqual(0)

        let depth = 0
        let destroyEnd = -1
        for (let i = bodyStart; i < source.length; i++) {
            const char = source[i]
            if (char === '{') {
                depth++
            } else if (char === '}') {
                depth--
                if (depth === 0) {
                    destroyEnd = i
                    break
                }
            }
        }

        expect(destroyEnd).toBeGreaterThan(bodyStart)

        const destroySource = source.slice(bodyStart, destroyEnd)
        const stopIndex = destroySource.indexOf('this.stop()')
        const cleanupIndex = destroySource.indexOf('await this.cleanupAll()')
        const destroyedIndex = destroySource.lastIndexOf('this.isDestroyed = true')

        expect(stopIndex).toBeGreaterThanOrEqual(0)
        expect(cleanupIndex).toBeGreaterThan(stopIndex)
        expect(destroyedIndex).toBeGreaterThan(cleanupIndex)
    })

    it('should block start and reuse the same destroy operation while cleanup is in progress', async () => {
        const manager = new TempFileManager()
        let cleanupCalls = 0
        let resolveCleanup: (() => void) | null = null

        ;(
            manager as TempFileManager & {
                cleanupAll: () => Promise<{ removed: number; errors: number }>
            }
        ).cleanupAll = async () => {
            cleanupCalls++
            await new Promise<void>((resolve) => {
                resolveCleanup = resolve
            })
            return { removed: 0, errors: 0 }
        }

        const destroy1 = manager.destroy()
        const destroy2 = manager.destroy()

        expect(cleanupCalls).toBe(1)
        expect(() => manager.start()).toThrow('TempFileManager is destroyed, cannot start')
        expect(resolveCleanup).not.toBeNull()

        resolveCleanup?.()
        await Promise.all([destroy1, destroy2])

        expect(() => manager.start()).toThrow('TempFileManager is destroyed, cannot start')
    })
})
