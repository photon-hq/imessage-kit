/**
 * Message Processing Chain
 */

import type { Mapper, Predicate } from '../types/advanced'
import type { Message } from '../types/message'
import type { MessageSender } from './sender'

/**
 * Message Processing Chain
 *
 * Note: You must explicitly call execute() to perform operations
 *
 * @example
 * ```ts
 * await sdk.message(msg)
 *   .ifFromOthers()
 *   .matchText('hello')
 *   .replyText('Hi!')
 *   .execute()  // Must call execute()
 * ```
 */
export class MessageChain {
    /** Whether to execute */
    private shouldExecute = true

    /** Actions */
    private actions: Array<() => Promise<void>> = []

    /** Whether already executed */
    private executed = false

    constructor(
        /** Message */
        private readonly message: Message,
        /** Sender */
        private readonly sender: MessageSender
    ) {
        /** If you forgot to call .execute(), we will automatically detect and warn you */
        if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
            /** Development mode: Delayed execution detection */
            setTimeout(() => {
                if (!this.executed && this.actions.length > 0) {
                    console.warn(
                        '[MessageChain] Warning: Unexecuted message chain detected.',
                        'You need to explicitly call .execute() method.\n',
                        `Message ID: ${this.message.id}, Sender: ${this.message.sender}`
                    )
                }
            }, 1000)
        }
    }

    /**
     * Conditional check
     */
    when(predicate: Predicate<Message>): this {
        if (this.shouldExecute) {
            this.shouldExecute = predicate(this.message)
        }
        return this
    }

    /**
     * Match text pattern
     */
    matchText(pattern: string | RegExp): this {
        return this.when((m) => {
            if (!m.text) return false
            return typeof pattern === 'string' ? m.text.includes(pattern) : pattern.test(m.text)
        })
    }

    /**
     * Only process unread messages
     */
    ifUnread(): this {
        return this.when((m) => !m.isRead)
    }

    /**
     * Only process messages from others
     */
    ifFromOthers(): this {
        return this.when((m) => !m.isFromMe)
    }

    /**
     * Only process my own messages
     */
    ifFromMe(): this {
        return this.when((m) => m.isFromMe)
    }

    /**
     * Only process group chat messages
     */
    ifGroupChat(): this {
        return this.when((m) => m.isGroupChat)
    }

    /**
     * Reply with text
     */
    replyText(text: string | Mapper<Message, string>): this {
        if (this.shouldExecute) {
            this.actions.push(async () => {
                const replyText = typeof text === 'function' ? text(this.message) : text
                await this.sender.text(this.message.sender, replyText)
            })
        }
        return this
    }

    /**
     * Reply with image
     */
    replyImage(images: string | string[] | Mapper<Message, string | string[]>): this {
        if (this.shouldExecute) {
            this.actions.push(async () => {
                const imagePaths = typeof images === 'function' ? images(this.message) : images
                const paths = Array.isArray(imagePaths) ? imagePaths : [imagePaths]
                await this.sender.textWithImages(this.message.sender, '', paths)
            })
        }
        return this
    }

    /**
     * Execute custom operation
     */
    do(handler: (message: Message) => void | Promise<void>): this {
        if (this.shouldExecute) {
            this.actions.push(async () => {
                await Promise.resolve(handler(this.message))
            })
        }
        return this
    }

    /**
     * Execute all operations (explicit call)
     *
     * This is the only method that actually performs operations
     *
     * @throws If an error occurs during execution
     */
    async execute(): Promise<void> {
        this.executed = true

        if (!this.shouldExecute || this.actions.length === 0) {
            return
        }

        for (const action of this.actions) {
            await action()
        }
    }
}
