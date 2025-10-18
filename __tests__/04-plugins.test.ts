/**
 * Plugin System Tests
 *
 * Tests for plugin manager and plugin lifecycle
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { type Plugin, PluginManager, definePlugin } from '../src/plugins/core'
import { loggerPlugin } from '../src/plugins/logger'
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
            await manager.callHookForAll('onInit')
            expect(initSpy.callCount()).toBe(0)
        })
    })

    describe('callHookForAll', () => {
        it('should call hook for all plugins that have it', async () => {
            const spy1 = createSpy<(to: string) => void>()
            const spy2 = createSpy<(to: string) => void>()

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

            await manager.callHookForAll('onBeforeSend', '+1234567890', { text: 'Hello' })

            expect(spy1.callCount()).toBe(1)
            expect(spy2.callCount()).toBe(1)
            expect(spy1.calls[0]?.args[0]).toBe('+1234567890')
        })

        it('should handle hook errors gracefully', async () => {
            const errorSpy = createSpy<(error: Error) => void>()

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

            const errors = await manager.callHookForAll('onBeforeSend', '+1234567890', {})

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
            await manager.callHookForAll('onBeforeSend', '+1234567890', {})

            expect(completed).toBe(true)
        })

        it('should return empty array when no plugins have hook', async () => {
            manager.use({ name: 'plugin1' })
            manager.use({ name: 'plugin2' })

            const errors = await manager.callHookForAll('onNewMessage', {} as any)

            expect(errors).toEqual([])
        })
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

describe('loggerPlugin', () => {
    it('should create logger plugin with defaults', () => {
        const plugin = loggerPlugin()

        expect(plugin.name).toBe('logger')
        expect(plugin.version).toBe('1.0.0')
        expect(typeof plugin.onInit).toBe('function')
        expect(typeof plugin.onBeforeSend).toBe('function')
        expect(typeof plugin.onAfterSend).toBe('function')
        expect(typeof plugin.onNewMessage).toBe('function')
        expect(typeof plugin.onError).toBe('function')
        expect(typeof plugin.onDestroy).toBe('function')
    })

    it('should accept custom options', () => {
        const plugin = loggerPlugin({
            level: 'debug',
            colored: false,
            timestamp: true,
            logSend: false,
            logNewMessage: true,
        })

        expect(plugin.name).toBe('logger')
    })

    it('should not throw errors during logging', () => {
        const plugin = loggerPlugin({ level: 'info' })

        expect(() => plugin.onInit?.()).not.toThrow()
        expect(() => plugin.onBeforeSend?.('+1234567890', { text: 'Hi' })).not.toThrow()
        expect(() => plugin.onAfterSend?.('+1234567890', { sentAt: new Date() })).not.toThrow()
        expect(() => plugin.onError?.(new Error('Test'), 'context')).not.toThrow()
        expect(() => plugin.onDestroy?.()).not.toThrow()
    })
})
