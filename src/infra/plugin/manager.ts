/**
 * Plugin lifecycle management and hook dispatch.
 *
 * Hook dispatch modes (aligned with Vite/Rollup industry consensus):
 *   - Sequential: onInit, onBefore*, onError, onDestroy — order matters, one at a time
 *   - Parallel: onAfter*, onNewMessage — independent, concurrent for performance
 *
 * Plugin ordering via `order` property:
 *   - 'pre' plugins run first within their dispatch group
 *   - 'post' plugins run last
 *   - Unset (normal) plugins run in registration order between pre and post
 */

import type { MessageSink } from '../../application/message-dispatcher'
import { toError } from '../../domain/errors'
import type { Message } from '../../domain/message'
import type { Plugin, PluginErrorContext, PluginHooks } from '../../types/plugin'

// -----------------------------------------------
// Hook Classification
// -----------------------------------------------

const SEQUENTIAL_HOOKS: ReadonlySet<keyof PluginHooks> = new Set([
    'onInit',
    'onBeforeMessageQuery',
    'onBeforeChatQuery',
    'onBeforeSend',
    'onError',
    'onDestroy',
])

// -----------------------------------------------
// PluginManager
// -----------------------------------------------

/** Manages plugin registration, lifecycle, and hook dispatch. */
export class PluginManager {
    private plugins: Plugin[] = []
    private pendingInits: Promise<void>[] = []
    private destroying = false
    private _initialized = false

    get initialized(): boolean {
        return this._initialized
    }

    // -----------------------------------------------
    // Registration
    // -----------------------------------------------

    /** Register a plugin. Deduplicates by name; late registrations auto-init. */
    use(plugin: Plugin): this {
        if (this.plugins.some((current) => current.name === plugin.name)) {
            throw new Error(`Plugin "${plugin.name}" is already registered`)
        }

        this.plugins.push(plugin)

        if (this._initialized && !this.destroying && plugin.onInit) {
            const initPromise = Promise.resolve()
                .then(() => plugin.onInit?.())
                .catch((error) => this.reportHookError(plugin.name, 'onInit', error))
            this.pendingInits.push(initPromise)
        }

        return this
    }

    // -----------------------------------------------
    // Lifecycle
    // -----------------------------------------------

    /** Initialize all registered plugins. Idempotent — subsequent calls flush late registrations. */
    async init(): Promise<void> {
        if (this._initialized) {
            await this.flushPendingInits()
            return
        }

        this._initialized = true
        await this.callHook('onInit')
        await this.flushPendingInits()
    }

    /** Destroy all plugins and reset state. */
    async destroy(): Promise<void> {
        if (this.destroying) return

        this.destroying = true

        try {
            await this.flushPendingInits()
            await this.callHook('onDestroy')
            this.plugins = []
            this._initialized = false
        } finally {
            this.destroying = false
        }
    }

    // -----------------------------------------------
    // Hook Dispatch
    // -----------------------------------------------

    /** Dispatch a hook to all plugins that implement it. */
    async callHook<K extends keyof PluginHooks>(
        hookName: K,
        ...args: Parameters<NonNullable<PluginHooks[K]>>
    ): Promise<Array<{ readonly plugin: string; readonly error: Error }>> {
        const pluginsWithHook = this.sortedPluginsWithHook(hookName)

        if (pluginsWithHook.length === 0) return []

        const errors = SEQUENTIAL_HOOKS.has(hookName)
            ? await this.dispatchSequential(pluginsWithHook, hookName, args)
            : await this.dispatchParallel(pluginsWithHook, hookName, args)

        if (errors.length > 0 && hookName !== 'onError') {
            for (const { plugin, error } of errors) {
                await this.reportHookError(plugin, hookName as Exclude<keyof PluginHooks, 'onError'>, error)
            }
        }

        return errors
    }

    // -----------------------------------------------
    // Dispatch Strategies
    // -----------------------------------------------

    private async dispatchSequential<K extends keyof PluginHooks>(
        plugins: Plugin[],
        hookName: K,
        args: Parameters<NonNullable<PluginHooks[K]>>
    ): Promise<Array<{ readonly plugin: string; readonly error: Error }>> {
        const errors: Array<{ readonly plugin: string; readonly error: Error }> = []

        for (const plugin of plugins) {
            try {
                const hook = plugin[hookName]
                if (hook === undefined) continue
                const hookFn = hook as (...a: typeof args) => void | Promise<void>
                await Promise.resolve(hookFn(...args))
            } catch (error) {
                errors.push({ plugin: plugin.name, error: toError(error) })
            }
        }

        return errors
    }

    private async dispatchParallel<K extends keyof PluginHooks>(
        plugins: Plugin[],
        hookName: K,
        args: Parameters<NonNullable<PluginHooks[K]>>
    ): Promise<Array<{ readonly plugin: string; readonly error: Error }>> {
        const results = await Promise.allSettled(
            plugins.map(async (plugin) => {
                try {
                    const hook = plugin[hookName]
                    if (hook === undefined) {
                        throw new Error(`Invariant: plugin "${plugin.name}" is missing hook ${String(hookName)}`)
                    }
                    const hookFn = hook as (...a: typeof args) => void | Promise<void>
                    await Promise.resolve(hookFn(...args))

                    return { plugin: plugin.name, success: true as const }
                } catch (error) {
                    return { plugin: plugin.name, success: false as const, error: toError(error) }
                }
            })
        )

        const errors: Array<{ readonly plugin: string; readonly error: Error }> = []

        for (const result of results) {
            if (result.status === 'fulfilled' && !result.value.success) {
                errors.push({ plugin: result.value.plugin, error: result.value.error })
            } else if (result.status === 'rejected') {
                errors.push({ plugin: 'unknown', error: toError(result.reason) })
            }
        }

        return errors
    }

    // -----------------------------------------------
    // Ordering
    // -----------------------------------------------

    private sortedPluginsWithHook<K extends keyof PluginHooks>(hookName: K): Plugin[] {
        const withHook = this.plugins.filter((p) => p[hookName])
        if (withHook.length <= 1) return withHook

        const pre: Plugin[] = []
        const normal: Plugin[] = []
        const post: Plugin[] = []

        for (const plugin of withHook) {
            if (plugin.order === 'pre') pre.push(plugin)
            else if (plugin.order === 'post') post.push(plugin)
            else normal.push(plugin)
        }

        return [...pre, ...normal, ...post]
    }

    // -----------------------------------------------
    // Error Reporting
    // -----------------------------------------------

    private async flushPendingInits(): Promise<void> {
        if (this.pendingInits.length > 0) {
            await Promise.all(this.pendingInits)
            this.pendingInits = []
        }
    }

    private async reportHookError(
        plugin: string,
        hookName: Exclude<keyof PluginHooks, 'onError'>,
        error: unknown
    ): Promise<void> {
        const normalizedError = toError(error)
        console.error(`[Plugin ${plugin}] ${hookName} failed:`, normalizedError)

        try {
            await this.callHook('onError', {
                error: normalizedError,
                context: `Plugin ${plugin} - ${String(hookName)}`,
            })
        } catch (hookError) {
            // Log but don't rethrow to prevent infinite recursion
            console.error(`[Plugin] onError hook failed (suppressed to prevent recursion):`, toError(hookError))
        }
    }
}

// -----------------------------------------------
// Helpers
// -----------------------------------------------

/** Identity function that provides type inference for plugin definitions. */
export const definePlugin = (plugin: Plugin): Plugin => plugin

/** Create a MessageSink that forwards to plugin hooks. */
export function createPluginMessageSink(manager: PluginManager): MessageSink {
    return {
        async onMessage(message: Message): Promise<void> {
            await manager.callHook('onNewMessage', { message })
        },
        onError(error: Error, context: string): void {
            const ctx: PluginErrorContext = { error, context }
            void manager.callHook('onError', ctx)
        },
    }
}
