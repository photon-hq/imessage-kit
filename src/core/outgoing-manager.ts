/**
 * Outgoing Message Manager
 *
 * Manages all pending outgoing messages and matches them with database entries
 */

import type { Message } from '../types/message'
import type { MessagePromise } from './message-promise'

export class OutgoingMessageManager {
    private promises: MessagePromise[] = []
    private debug: boolean

    constructor(debug = false) {
        this.debug = debug
    }

    /**
     * Add a new message promise to track
     */
    add(promise: MessagePromise): void {
        this.promises.push(promise)

        if (this.debug) {
            console.log(
                `[OutgoingManager] Tracking new ${promise.isAttachment ? 'attachment' : 'message'}: ${promise.chatId}`
            )
        }
    }

    /**
     * Try to match and resolve a message promise
     * Returns true if a match was found
     */
    tryResolve(message: Message): boolean {
        // Only process messages from self
        if (!message.isFromMe) {
            return false
        }

        // Find matching promise
        for (let i = 0; i < this.promises.length; i++) {
            const promise = this.promises[i]

            if (!promise || promise.isResolved) continue

            if (promise.matches(message)) {
                if (this.debug) {
                    console.log(`[OutgoingManager] Matched message: ${message.id}`)
                }

                promise.resolve(message)
                return true
            }
        }

        return false
    }

    /**
     * Clean up resolved promises (older than 1 minute)
     */
    cleanup(): void {
        const now = Date.now()
        const oneMinute = 60 * 1000

        this.promises = this.promises.filter((p) => {
            if (!p.isResolved) return true

            // Keep resolved promises for 1 minute
            return now - p.sentAt < oneMinute
        })
    }

    /**
     * Get count of pending promises
     */
    getPendingCount(): number {
        return this.promises.filter((p) => !p.isResolved).length
    }

    /**
     * Reject all pending promises (used when closing SDK)
     */
    rejectAll(reason = 'SDK closed'): void {
        for (const promise of this.promises) {
            if (!promise.isResolved) {
                promise.reject(reason)
            }
        }
        this.promises = []
    }
}
