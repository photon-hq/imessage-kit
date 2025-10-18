/**
 * Plugin System
 *
 * Plugins can listen to the following lifecycle hooks:
 * - SDK initialization and destruction
 * - Before and after message queries
 * - Before and after sending messages
 * - When new messages are received
 * - When errors occur
 */

import type { Message, SendResult } from '../types/message'

/**
 * Plugin lifecycle hooks
 */
export interface PluginHooks {
    /** Called when SDK initialization is complete */
    onInit?: () => void | Promise<void>

    /** Called before querying messages (useful for logging) */
    onBeforeQuery?: (filter: unknown) => void | Promise<void>

    /** Called after querying messages (useful for data processing) */
    onAfterQuery?: (messages: readonly Message[]) => void | Promise<void>

    /** Called before sending a message (useful for validation, logging) */
    onBeforeSend?: (to: string, content: { text?: string; attachments?: string[] }) => void | Promise<void>

    /** Called after sending a message (useful for logging results) */
    onAfterSend?: (to: string, result: SendResult) => void | Promise<void>

    /** Called when a new message is received (triggered by listener) */
    onNewMessage?: (message: Message) => void | Promise<void>

    /** Called when an error occurs (global error handling) */
    onError?: (error: Error, context?: string) => void | Promise<void>

    /** Called when SDK is destroyed (cleanup resources) */
    onDestroy?: () => void | Promise<void>
}

/**
 * Plugin metadata
 */
export interface PluginMetadata {
    /** Unique plugin name */
    readonly name: string

    /** Plugin version number (optional) */
    readonly version?: string

    /** Plugin description (optional) */
    readonly description?: string
}

/**
 * Complete plugin interface
 * Plugin = metadata + hook functions
 */
export interface Plugin extends PluginMetadata, PluginHooks {}

/**
 * Plugin manager
 */
export class PluginManager {
    /** List of registered plugins */
    private plugins: Plugin[] = []

    /** Whether the plugin manager has been initialized */
    initialized = false

    /**
     * Register a plugin
     * If the manager is already initialized, the plugin's onInit hook will be called immediately
     * @param plugin Plugin instance
     * @returns this - Supports method chaining
     */
    use(plugin: Plugin): this {
        this.plugins.push(plugin)

        if (this.initialized && plugin.onInit) {
            Promise.resolve(plugin.onInit()).catch((error) => {
                const errorMsg = `[Plugin ${plugin.name}] Initialization failed:`
                console.error(errorMsg, error)
            })
        }

        return this
    }

    /**
     * Initialize all plugins
     * Calls the onInit hook for all plugins
     */
    async init(): Promise<void> {
        this.initialized = true
        await this.callHookForAll('onInit')
    }

    /**
     * Destroy all plugins
     * Calls the onDestroy hook for all plugins and clears the plugin list
     */
    async destroy(): Promise<void> {
        await this.callHookForAll('onDestroy')
        this.plugins = []
        this.initialized = false
    }

    /**
     * Call the specified hook for all plugins
     * @param hookName Hook name
     * @param args Hook arguments
     * @returns List of plugin errors (if any)
     */
    async callHookForAll<K extends keyof PluginHooks>(
        hookName: K,
        ...args: Parameters<NonNullable<PluginHooks[K]>>
    ): Promise<Array<{ plugin: string; error: Error }>> {
        const pluginsWithHook = this.plugins.filter((p) => p[hookName])

        if (pluginsWithHook.length === 0) {
            return []
        }

        const results = await Promise.allSettled(
            pluginsWithHook.map(async (plugin) => {
                try {
                    const hook = plugin[hookName]!
                    const hookFn = hook as (...a: typeof args) => void | Promise<void>
                    await Promise.resolve(hookFn(...args))

                    return {
                        plugin: plugin.name,
                        success: true,
                    }
                } catch (error) {
                    const normalizedError = error instanceof Error ? error : new Error(String(error))

                    return {
                        plugin: plugin.name,
                        success: false,
                        error: normalizedError,
                    }
                }
            })
        )

        // Collect all errors
        const errors: Array<{ plugin: string; error: Error }> = []

        for (const result of results) {
            if (result.status === 'fulfilled' && !result.value.success) {
                errors.push({
                    plugin: result.value.plugin,
                    error: result.value.error!,
                })
            } else if (result.status === 'rejected') {
                const normalizedError =
                    result.reason instanceof Error ? result.reason : new Error(String(result.reason))

                errors.push({
                    plugin: 'unknown',
                    error: normalizedError,
                })
            }
        }

        // If there are errors and it's not the onError hook, trigger the onError hook
        if (errors.length > 0 && hookName !== 'onError') {
            for (const { plugin, error } of errors) {
                console.error(`[Plugin ${plugin}] ${hookName} failed:`, error)

                // Trigger onError hook (recursive, but won't trigger onError again)
                try {
                    const context = `Plugin ${plugin} - ${String(hookName)}`
                    await this.callHookForAll('onError', error, context)
                } catch {
                    // Ignore onError hook errors to avoid infinite loops
                }
            }
        }

        return errors
    }
}

/**
 * Helper function to define a plugin
 */
export const definePlugin = (plugin: Plugin) => plugin
