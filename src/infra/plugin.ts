/**
 * Plugin lifecycle management and hook dispatch.
 *
 * Three dispatch modes (aligned with Vite/Rollup conventions):
 *   - Interrupting (fail-fast): onBefore*   — first throw aborts the SDK operation.
 *     Go through `callInterruptingHook`.
 *   - Sequential (observing):   onInit, onError, onDestroy — run one at a time,
 *     failures collected and reported to `onError`. Go through `callHook`.
 *   - Parallel (observing):     onAfter*, onIncomingMessage, onFromMe — concurrent,
 *     failures collected and reported to `onError`. Go through `callHook`.
 *
 * Plugin ordering via `order` property within each mode:
 *   - 'pre' plugins run first
 *   - 'post' plugins run last
 *   - Unset (normal) plugins run in registration order between pre and post
 */

import type { MessageSink } from '../application/message-dispatcher'
import { ConfigError, type ErrorCode, IMessageError, toError } from '../domain/errors'
import type { Message } from '../domain/message'
import type { Plugin, PluginErrorContext, PluginHooks } from '../types/plugin'

// -----------------------------------------------
// Internal Types
// -----------------------------------------------

/** Error captured from a single plugin's hook execution. */
type HookError = { readonly plugin: string; readonly error: Error }

/** Any hook except `onError` — used to prevent recursive error reporting. */
type NonErrorHookName = Exclude<keyof PluginHooks, 'onError'>

// -----------------------------------------------
// Hook Classification
// -----------------------------------------------

/**
 * Hooks that `callHook` dispatches one at a time. These are lifecycle /
 * observation hooks where ordering matters but a single failure must not
 * cascade. The `onBefore*` family is not listed here — those go through
 * `callInterruptingHook`, which is fail-fast and rethrows.
 */
const SEQUENTIAL_HOOKS: ReadonlySet<keyof PluginHooks> = new Set(['onInit', 'onError', 'onDestroy'])

// -----------------------------------------------
// PluginManager
// -----------------------------------------------

/** Manages plugin registration, lifecycle, and hook dispatch. */
export class PluginManager {
    private plugins: Plugin[] = []
    /**
     * Plugins whose `onInit` is still running. They are deliberately excluded
     * from hook dispatch until init completes — otherwise a plugin could
     * receive `onIncomingMessage` / `onBeforeSend` before its `onInit` had a chance
     * to run, violating the documented lifecycle contract.
     */
    private pendingPlugins: Plugin[] = []
    private pendingInits: Promise<void>[] = []
    private destroying = false
    private destroyPromise: Promise<void> | null = null
    /** Shared promise for concurrent `init()` callers; `_initialized` is an observation flag, not a gate. */
    private initPromise: Promise<void> | null = null
    private _initialized = false

    get initialized(): boolean {
        return this._initialized
    }

    // -----------------------------------------------
    // Registration
    // -----------------------------------------------

    /** Register a plugin. Deduplicates by name; late registrations auto-init. */
    use(plugin: Plugin): this {
        if (this.destroying) {
            throw ConfigError('PluginManager is destroying, cannot register new plugins')
        }

        const isDuplicate =
            this.plugins.some((current) => current.name === plugin.name) ||
            this.pendingPlugins.some((current) => current.name === plugin.name)
        if (isDuplicate) {
            throw ConfigError(`Plugin "${plugin.name}" is already registered`)
        }

        if (this.initPromise && plugin.onInit) {
            // Park the plugin in `pendingPlugins` so hook dispatch skips it
            // until `onInit` completes. Move to `plugins` afterwards, even
            // on init failure — a failed-init plugin is still registered
            // and should receive `onDestroy` for cleanup.
            //
            // Trigger condition is `initPromise`, not `_initialized`: a
            // concurrent init may have started but not yet resolved — plugins
            // registered in that window must still run their own onInit.
            this.pendingPlugins.push(plugin)
            const initPromise = (async () => {
                let initError: unknown = null
                try {
                    await plugin.onInit?.()
                } catch (error) {
                    initError = error
                }

                const idx = this.pendingPlugins.indexOf(plugin)
                if (idx !== -1) this.pendingPlugins.splice(idx, 1)
                this.plugins.push(plugin)

                if (initError !== null) {
                    await this.reportHookError(plugin.name, 'onInit', initError)
                }
            })()
            this.pendingInits.push(initPromise)
        } else {
            this.plugins.push(plugin)
        }

        return this
    }

    // -----------------------------------------------
    // Lifecycle
    // -----------------------------------------------

    /** Initialize all registered plugins. Idempotent — subsequent calls flush late registrations. */
    async init(): Promise<void> {
        if (this.initPromise) {
            await this.initPromise
            await this.flushPendingInits()
            return
        }

        this.initPromise = this.callHook('onInit').then(() => {
            this._initialized = true
        })
        await this.initPromise
        await this.flushPendingInits()
    }

    /**
     * Destroy all plugins and reset state. Concurrent callers await the
     * same in-flight destroy; sequential callers can re-register and
     * destroy again.
     */
    async destroy(): Promise<void> {
        if (this.destroyPromise) return this.destroyPromise

        this.destroyPromise = (async () => {
            this.destroying = true

            try {
                await this.flushPendingInits()
                await this.callHook('onDestroy')
                this.plugins = []
                this.pendingPlugins = []
                this._initialized = false
                this.initPromise = null
            } finally {
                this.destroying = false
                this.destroyPromise = null
            }
        })()

        return this.destroyPromise
    }

    // -----------------------------------------------
    // Hook Dispatch
    // -----------------------------------------------

    /**
     * Dispatch a hook to all plugins that implement it.
     *
     * Collects errors without interrupting the dispatch — each plugin runs
     * regardless of its peers' failures. Use `callInterruptingHook` for
     * hooks whose failure must abort the surrounding operation (e.g.
     * `onBeforeSend` acting as an authorisation gate).
     */
    async callHook<K extends keyof PluginHooks>(
        hookName: K,
        ...args: Parameters<NonNullable<PluginHooks[K]>>
    ): Promise<HookError[]> {
        const pluginsWithHook = this.sortedPluginsWithHook(hookName)

        if (pluginsWithHook.length === 0) return []

        const errors = SEQUENTIAL_HOOKS.has(hookName)
            ? await this.dispatchSequential(pluginsWithHook, hookName, args)
            : await this.dispatchParallel(pluginsWithHook, hookName, args)

        if (errors.length > 0 && hookName !== 'onError') {
            for (const { plugin, error } of errors) {
                await this.reportHookError(plugin, hookName as NonErrorHookName, error)
            }
        }

        return errors
    }

    /**
     * Fail-fast dispatch for interception-style hooks (`onBefore*`). The
     * first plugin that throws aborts dispatch; remaining plugins are NOT
     * invoked, and the throw is re-raised as `IMessageError(code, ...)`
     * with the original error as `cause`. Designed so a single plugin can
     * gate auth / rate-limit / policy by throwing.
     *
     * Deliberately does NOT route the rejection through `onError`: a gate
     * plugin rejecting a send is intended behaviour, not an unexpected
     * error, and logging every rejection as a plugin failure is noise.
     */
    async callInterruptingHook<K extends keyof PluginHooks>(
        hookName: K,
        code: ErrorCode,
        ...args: Parameters<NonNullable<PluginHooks[K]>>
    ): Promise<void> {
        const plugins = this.sortedPluginsWithHook(hookName)
        if (plugins.length === 0) return

        for (const plugin of plugins) {
            try {
                const hookFn = plugin[hookName] as (...a: typeof args) => void | Promise<void>
                await Promise.resolve(hookFn(...args))
            } catch (error) {
                const cause = toError(error)
                throw new IMessageError(
                    code,
                    `Plugin "${plugin.name}" ${String(hookName)} rejected: ${cause.message}`,
                    { cause }
                )
            }
        }
    }

    // -----------------------------------------------
    // Dispatch Strategies
    // -----------------------------------------------

    private async dispatchSequential<K extends keyof PluginHooks>(
        plugins: Plugin[],
        hookName: K,
        args: Parameters<NonNullable<PluginHooks[K]>>
    ): Promise<HookError[]> {
        const errors: HookError[] = []

        for (const plugin of plugins) {
            try {
                const hookFn = plugin[hookName] as (...a: typeof args) => void | Promise<void>
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
    ): Promise<HookError[]> {
        const outcomes = await Promise.all(
            plugins.map(async (plugin) => {
                try {
                    const hookFn = plugin[hookName] as (...a: typeof args) => void | Promise<void>
                    await Promise.resolve(hookFn(...args))

                    return { plugin: plugin.name, error: null as Error | null }
                } catch (error) {
                    return { plugin: plugin.name, error: toError(error) }
                }
            })
        )

        const errors: HookError[] = []

        for (const outcome of outcomes) {
            if (outcome.error !== null) {
                errors.push({ plugin: outcome.plugin, error: outcome.error })
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
    // Internal Helpers
    // -----------------------------------------------

    private async flushPendingInits(): Promise<void> {
        // Loop so late registrations arriving while we await the current
        // batch are picked up on the next iteration. Swap-before-await
        // prevents the bug where `this.pendingInits = []` at the end wipes
        // promises pushed during the await.
        while (this.pendingInits.length > 0) {
            const toFlush = this.pendingInits
            this.pendingInits = []
            await Promise.all(toFlush)
        }
    }

    private async reportHookError(plugin: string, hookName: NonErrorHookName, error: unknown): Promise<void> {
        const normalizedError = toError(error)
        console.error(`[Plugin ${plugin}] ${hookName} failed:`, normalizedError)

        try {
            await this.callHook('onError', {
                error: normalizedError,
                context: `Plugin ${plugin} - ${String(hookName)}`,
            })
        } catch (hookError) {
            // Log but don't rethrow to prevent infinite recursion
            console.error(
                `[Plugin ${plugin}] onError hook failed (suppressed to prevent recursion):`,
                toError(hookError)
            )
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
        async onIncomingMessage(message: Message): Promise<void> {
            await manager.callHook('onIncomingMessage', { message })
        },
        async onFromMe(message: Message): Promise<void> {
            await manager.callHook('onFromMe', { message })
        },
        onError(error: Error, context: string): void {
            const ctx: PluginErrorContext = { error, context }
            void manager.callHook('onError', ctx)
        },
    }
}
