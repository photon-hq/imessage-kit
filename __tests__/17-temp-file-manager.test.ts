import { describe, expect, it } from 'bun:test'
import { TempFileManager } from '../src/utils/temp-file-manager'

describe('TempFileManager destroy flow', () => {
    it('should keep the manager active until cleanup finishes', async () => {
        const manager = new TempFileManager()
        let destroyedDuringCleanup: boolean | null = null
        let destroyingDuringCleanup: boolean | null = null

        ;(
            manager as TempFileManager & {
                cleanupAll: () => Promise<{ removed: number; errors: number }>
                isDestroyed: boolean
                isDestroying: boolean
            }
        ).cleanupAll = async () => {
            destroyedDuringCleanup = (
                manager as TempFileManager & {
                    isDestroyed: boolean
                }
            ).isDestroyed
            destroyingDuringCleanup = (
                manager as TempFileManager & {
                    isDestroying: boolean
                }
            ).isDestroying
            return { removed: 0, errors: 0 }
        }

        await manager.destroy()

        expect(destroyedDuringCleanup).toBe(false)
        expect(destroyingDuringCleanup).toBe(true)
        expect(
            (
                manager as TempFileManager & {
                    isDestroyed: boolean
                }
            ).isDestroyed
        ).toBe(true)
        expect(
            (
                manager as TempFileManager & {
                    isDestroying: boolean
                }
            ).isDestroying
        ).toBe(false)
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
        expect(() => manager.start()).toThrow('TempFileManager is destroying, cannot start')
        expect(resolveCleanup).not.toBeNull()

        resolveCleanup?.()
        await Promise.all([destroy1, destroy2])

        expect(() => manager.start()).toThrow('TempFileManager is destroyed, cannot start')
    })
})
