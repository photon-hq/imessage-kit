/**
 * Fluent message processing chain.
 *
 * Evaluates predicates eagerly (short-circuiting on first false),
 * queues actions, and executes them only when execute() is called.
 */

import type { Message } from '../domain/message'
import type { SendPort } from './send-port'

// -----------------------------------------------
// Types
// -----------------------------------------------

/** Result of chain execution. */
export interface ChainResult {
    /** Number of actions that ran (successfully or not). */
    readonly actionsRun: number
    /** Errors from failed actions. Empty array if all succeeded. */
    readonly errors: readonly Error[]
}

// -----------------------------------------------
// Chain
// -----------------------------------------------

export class MessageChain {
    private active = true
    private readonly actions: Array<() => Promise<void>> = []
    private executed = false

    constructor(
        private readonly message: Message,
        private readonly sender: SendPort
    ) {}

    // -----------------------------------------------
    // Predicates
    // -----------------------------------------------

    /** Custom predicate. Short-circuits the chain if false. */
    when(predicate: (message: Message) => boolean): this {
        this.assertMutable()
        if (this.active) {
            this.active = predicate(this.message)
        }
        return this
    }

    /** Text contains the string or matches the regex. */
    matchText(pattern: string | RegExp): this {
        return this.when((m) => {
            if (!m.text) return false
            return typeof pattern === 'string' ? m.text.includes(pattern) : pattern.test(m.text)
        })
    }

    /** Message is from another participant (not the local user). */
    ifFromOthers(): this {
        return this.when((m) => !m.isFromMe)
    }

    /** Message is from the local user. */
    ifFromMe(): this {
        return this.when((m) => m.isFromMe)
    }

    /** Message is in a group chat. */
    ifGroup(): this {
        return this.when((m) => m.chatKind === 'group')
    }

    /** Message is a DM (1-on-1 chat). */
    ifDM(): this {
        return this.when((m) => m.chatKind === 'dm')
    }

    /** Message is a reaction (tapback, sticker, poll vote). */
    ifReaction(): this {
        return this.when((m) => m.reaction !== null)
    }

    /** Message is not a reaction. */
    ifNotReaction(): this {
        return this.when((m) => m.reaction === null)
    }

    /** Message has not been read. */
    ifUnread(): this {
        return this.when((m) => !m.isRead)
    }

    // -----------------------------------------------
    // Actions
    // -----------------------------------------------

    /** Queue a text reply to the message's chat. */
    replyText(text: string | ((message: Message) => string)): this {
        this.assertMutable()
        if (this.active) {
            this.actions.push(async () => {
                const content = typeof text === 'function' ? text(this.message) : text
                await this.sender.send({ to: this.message.chatId, text: content })
            })
        }
        return this
    }

    /** Queue an attachment reply to the message's chat. */
    replyAttachments(paths: string | string[] | ((message: Message) => string | string[])): this {
        this.assertMutable()
        if (this.active) {
            this.actions.push(async () => {
                const selected = typeof paths === 'function' ? paths(this.message) : paths
                const attachments = Array.isArray(selected) ? selected : [selected]
                await this.sender.send({ to: this.message.chatId, attachments })
            })
        }
        return this
    }

    /** Queue a custom handler. */
    do(handler: (message: Message) => void | Promise<void>): this {
        this.assertMutable()
        if (this.active) {
            this.actions.push(async () => {
                await handler(this.message)
            })
        }
        return this
    }

    // -----------------------------------------------
    // Execution
    // -----------------------------------------------

    /**
     * Execute all queued actions sequentially.
     *
     * Continues on error — all errors are collected in ChainResult.
     * Calling execute() more than once is a no-op.
     */
    async execute(): Promise<ChainResult> {
        if (this.executed) return { actionsRun: 0, errors: [] }
        this.executed = true

        if (!this.active || this.actions.length === 0) {
            return { actionsRun: 0, errors: [] }
        }

        const errors: Error[] = []
        let actionsRun = 0

        for (const action of this.actions) {
            actionsRun++
            try {
                await action()
            } catch (err) {
                errors.push(err instanceof Error ? err : new Error(String(err)))
            }
        }

        return { actionsRun, errors }
    }

    // -----------------------------------------------
    // Internal
    // -----------------------------------------------

    private assertMutable(): void {
        if (this.executed) {
            throw new Error('MessageChain has already been executed')
        }
    }
}
