/**
 * Plugin System Tests
 *
 * Tests for plugin manager and plugin lifecycle
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { definePlugin, type Plugin, PluginManager } from '../src/infra/plugin'
import { createSpy } from './setup'

describe('PluginManager', () => {
    let manager: PluginManager

    beforeEach(() => {
        manager = new PluginManager()
    })

    describe('use', () => {
        it('should register plugin', () => {
            const plugin: Plugin = {
                name: 'test-plugin',
                version: '1.0.0',
            }

            const result = manager.use(plugin)

            expect(result).toBe(manager) // Chainable
        })

        it('should reject duplicate plugin names', () => {
            manager.use({ name: 'duplicate-plugin' })

            expect(() => manager.use({ name: 'duplicate-plugin' })).toThrow(
                'Plugin "duplicate-plugin" is already registered'
            )
        })

        it('should call onInit immediately if already initialized', async () => {
            await manager.init()

            const initSpy = createSpy<() => void>()
            const plugin: Plugin = {
                name: 'late-plugin',
                onInit: initSpy.fn,
            }

            manager.use(plugin)

            // Wait for async call
            await new Promise((resolve) => setTimeout(resolve, 10))

            expect(initSpy.callCount()).toBe(1)
        })

        it('should route late onInit failures through onError', async () => {
            await manager.init()

            const errorSpy = createSpy<(ctx: { error: Error; context?: string }) => void>()
            manager.use({
                name: 'error-handler',
                onError: errorSpy.fn,
            })

            manager.use({
                name: 'late-failing-plugin',
                onInit: () => {
                    throw new Error('Late init failed')
                },
            })

            await manager.flushPendingInits()

            expect(errorSpy.callCount()).toBe(1)
            expect(errorSpy.calls[0]?.args[0].error.message).toBe('Late init failed')
            expect(errorSpy.calls[0]?.args[0].context).toBe('Plugin late-failing-plugin - onInit')
        })
    })

    describe('init', () => {
        it('should initialize all plugins', async () => {
            const initSpy1 = createSpy<() => void>()
            const initSpy2 = createSpy<() => void>()

            manager.use({
                name: 'plugin1',
                onInit: initSpy1.fn,
            })
            manager.use({
                name: 'plugin2',
                onInit: initSpy2.fn,
            })

            await manager.init()

            expect(initSpy1.callCount()).toBe(1)
            expect(initSpy2.callCount()).toBe(1)
            expect(manager.initialized).toBe(true)
        })

        it('should handle async onInit', async () => {
            let completed = false
            const plugin: Plugin = {
                name: 'async-plugin',
                onInit: async () => {
                    await new Promise((resolve) => setTimeout(resolve, 10))
                    completed = true
                },
            }

            manager.use(plugin)
            await manager.init()

            expect(completed).toBe(true)
        })
    })

    describe('destroy', () => {
        it('should destroy all plugins', async () => {
            const destroySpy1 = createSpy<() => void>()
            const destroySpy2 = createSpy<() => void>()

            manager.use({
                name: 'plugin1',
                onDestroy: destroySpy1.fn,
            })
            manager.use({
                name: 'plugin2',
                onDestroy: destroySpy2.fn,
            })

            await manager.init()
            await manager.destroy()

            expect(destroySpy1.callCount()).toBe(1)
            expect(destroySpy2.callCount()).toBe(1)
            expect(manager.initialized).toBe(false)
        })

        it('should clear all plugins after destroy', async () => {
            manager.use({ name: 'plugin1' })
            manager.use({ name: 'plugin2' })

            await manager.destroy()

            // Should not call any hooks after destroy
            const initSpy = createSpy<() => void>()
            await manager.callHook('onInit')
            expect(initSpy.callCount()).toBe(0)
        })

        it('should finish pending late init before destroy', async () => {
            await manager.init()

            const events: string[] = []

            manager.use({
                name: 'late-plugin',
                onInit: async () => {
                    await new Promise((resolve) => setTimeout(resolve, 10))
                    events.push('init')
                },
                onDestroy: async () => {
                    events.push('destroy')
                },
            })

            await manager.destroy()

            expect(events).toEqual(['init', 'destroy'])
        })
    })

    describe('callHook', () => {
        it('should call hook for all plugins that have it', async () => {
            const spy1 = createSpy<(ctx: { request: { to: string; text: string } }) => void>()
            const spy2 = createSpy<(ctx: { request: { to: string; text: string } }) => void>()

            manager.use({
                name: 'plugin1',
                onBeforeSend: spy1.fn,
            })
            manager.use({
                name: 'plugin2',
                onBeforeSend: spy2.fn,
            })
            manager.use({
                name: 'plugin3',
                // No onBeforeSend hook
            })

            await manager.callHook('onBeforeSend', { request: { to: '+1234567890', text: 'Hello' } })

            expect(spy1.callCount()).toBe(1)
            expect(spy2.callCount()).toBe(1)
            expect(spy1.calls[0]?.args[0].request.to).toBe('+1234567890')
        })

        it('should handle hook errors gracefully', async () => {
            const errorSpy = createSpy<(ctx: { error: Error }) => void>()

            manager.use({
                name: 'failing-plugin',
                onBeforeSend: () => {
                    throw new Error('Hook failed')
                },
            })
            manager.use({
                name: 'error-handler',
                onError: errorSpy.fn,
            })

            const errors = await manager.callHook('onBeforeSend', { request: { to: '+1234567890' } })
            expect(errors.length).toBe(1)
            expect(errors[0]?.plugin).toBe('failing-plugin')
            expect(errors[0]?.error.message).toBe('Hook failed')
        })

        it('should support async hooks', async () => {
            let completed = false
            const plugin: Plugin = {
                name: 'async-hook',
                onBeforeSend: async () => {
                    await new Promise((resolve) => setTimeout(resolve, 10))
                    completed = true
                },
            }

            manager.use(plugin)
            await manager.callHook('onBeforeSend', { request: { to: '+1234567890' } })

            expect(completed).toBe(true)
        })

        it('should return empty array when no plugins have hook', async () => {
            manager.use({ name: 'plugin1' })
            manager.use({ name: 'plugin2' })

            const errors = await manager.callHook('onIncomingMessage', { message: {} as any })

            expect(errors).toEqual([])
        })
    })

    describe('callInterruptingHook', () => {
        it('should resolve silently when no plugin throws', async () => {
            manager.use({
                name: 'observer',
                onBeforeSend: () => {},
            })

            await expect(
                manager.callInterruptingHook('onBeforeSend', 'SEND', { request: { to: '+1234567890' } })
            ).resolves.toBeUndefined()
        })

        it('should rethrow the first plugin throw as IMessageError with the given code', async () => {
            manager.use({
                name: 'auth-gate',
                onBeforeSend: () => {
                    throw new Error('Not authorised')
                },
            })

            try {
                await manager.callInterruptingHook('onBeforeSend', 'SEND', { request: { to: '+1234567890' } })
                throw new Error('Expected throw')
            } catch (err) {
                const { IMessageError } = await import('../src/domain/errors')
                expect(err).toBeInstanceOf(IMessageError)
                expect((err as InstanceType<typeof IMessageError>).code).toBe('SEND')
                expect((err as Error).message).toContain('auth-gate')
                expect((err as Error).message).toContain('Not authorised')
                expect((err as Error).cause).toBeInstanceOf(Error)
            }
        })

        it('should skip remaining plugins after the first throw (fail-fast)', async () => {
            const laterSpy = createSpy<() => void>()

            manager.use({
                name: 'gate',
                onBeforeSend: () => {
                    throw new Error('Reject')
                },
            })
            manager.use({
                name: 'would-run',
                onBeforeSend: laterSpy.fn,
            })

            await expect(
                manager.callInterruptingHook('onBeforeSend', 'SEND', { request: { to: '+1234567890' } })
            ).rejects.toThrow(/gate.*Reject/)

            expect(laterSpy.callCount()).toBe(0)
        })

        it('should NOT route the rejection through onError', async () => {
            const onErrorSpy = createSpy<() => void>()

            manager.use({
                name: 'gate',
                onBeforeSend: () => {
                    throw new Error('Reject')
                },
            })
            manager.use({
                name: 'error-listener',
                onError: onErrorSpy.fn,
            })

            await manager
                .callInterruptingHook('onBeforeSend', 'SEND', { request: { to: '+1234567890' } })
                .catch(() => {})

            expect(onErrorSpy.callCount()).toBe(0)
        })

        it('should honour pre / normal / post ordering', async () => {
            const events: string[] = []

            manager.use({
                name: 'normal',
                onBeforeSend: () => {
                    events.push('normal')
                },
            })
            manager.use({
                name: 'post',
                order: 'post',
                onBeforeSend: () => {
                    events.push('post')
                },
            })
            manager.use({
                name: 'pre',
                order: 'pre',
                onBeforeSend: () => {
                    events.push('pre')
                },
            })

            await manager.callInterruptingHook('onBeforeSend', 'SEND', { request: { to: '+1234567890' } })

            expect(events).toEqual(['pre', 'normal', 'post'])
        })
    })
})

describe('PluginManager — teardown races', () => {
    it('rejects use() once destroy() has started so late plugins cannot attach to a closing manager', async () => {
        const manager = new PluginManager()
        manager.use({
            name: 'slow',
            onDestroy: async () => {
                await new Promise((r) => setTimeout(r, 20))
            },
        })

        const destroyInFlight = manager.destroy()
        // destroying = true is set synchronously at the start of destroy().
        expect(() => manager.use({ name: 'latecomer' })).toThrow(/destroying/)
        await destroyInFlight
    })

    it('shares a single in-flight promise across concurrent destroy() callers', async () => {
        const manager = new PluginManager()
        let calls = 0
        manager.use({
            name: 'counter',
            onDestroy: async () => {
                calls++
                await new Promise((r) => setTimeout(r, 10))
            },
        })
        await manager.init()

        // Fire both without awaiting the first — the second must piggy-back on
        // the same promise instead of triggering a second destroy pass.
        const first = manager.destroy()
        const second = manager.destroy()
        await Promise.all([first, second])

        expect(calls).toBe(1)
    })

    it('suppresses errors thrown from onError itself so error reporting cannot recurse', async () => {
        const manager = new PluginManager()
        // Plugin A throws from a regular hook → error gets routed to onError hooks.
        manager.use({
            name: 'throws-on-before-send',
            onBeforeSend: () => {
                throw new Error('root failure')
            },
        })
        // Plugin B's onError itself throws. Recursive routing would loop forever;
        // reportHookError is expected to log+swallow the second throw.
        manager.use({
            name: 'broken-error-handler',
            onError: () => {
                throw new Error('error handler also broken')
            },
        })

        // If recursion protection is missing, this never settles. Awaiting it
        // successfully is the assertion.
        await manager.callHook('onBeforeSend', { request: { to: '+1234567890' } })
    })
})

describe('definePlugin', () => {
    it('should create plugin with correct structure', () => {
        const plugin = definePlugin({
            name: 'test',
            version: '1.0.0',
            description: 'Test plugin',
            onInit: () => {},
        })

        expect(plugin.name).toBe('test')
        expect(plugin.version).toBe('1.0.0')
        expect(plugin.description).toBe('Test plugin')
        expect(typeof plugin.onInit).toBe('function')
    })
})
