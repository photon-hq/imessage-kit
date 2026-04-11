/**
 * iMessage attachment model.
 *
 * File transfer states (raw `transfer_state` values):
 *
 *   -1  archiving         metadata exists, no local file yet
 *    0  waitingForAccept   queued, transfer not started
 *    1  accepted           transfer request accepted
 *    2  preparing          encoding / compressing
 *    3  transferring       active data transmission
 *    4  finalizing         writing to disk / post-processing
 *    5  finished           file available on disk
 *    6  error              non-recoverable failure
 *    7  recoverableError   transient failure, may retry
 *
 * Normalized into four consumer-facing states:
 *   pending      ← -1, 0
 *   transferring ← 1, 2, 3, 4
 *   complete     ← 5
 *   failed       ← 6, 7
 */

// -----------------------------------------------
// Types
// -----------------------------------------------

/** Normalized attachment transfer status. */
export type TransferStatus = 'pending' | 'transferring' | 'complete' | 'failed' | 'unknown'

/** Attachment linked to a message. */
export interface Attachment {
    /** Stable identifier derived from `attachment.guid`. */
    readonly id: string
    /** Preferred file name: `transfer_name` if available, otherwise local path basename. */
    readonly fileName: string | null
    /** Absolute local path when the file exists on disk. */
    readonly localPath: string | null
    /** MIME type such as `image/jpeg`. */
    readonly mimeType: string
    /** Uniform Type Identifier such as `public.jpeg`. */
    readonly uti: string | null
    /** File size in bytes. */
    readonly sizeBytes: number
    /** Typed transfer status resolved from `attachment.transfer_state`. */
    readonly transferStatus: TransferStatus
    /** Whether the attachment was sent by the local user. */
    readonly isOutgoing: boolean
    /** Whether the attachment is a sticker. */
    readonly isSticker: boolean
    /** Flagged by Apple Communication Safety (child safety content scanning). */
    readonly isSensitiveContent: boolean
    /** Accessibility alt text or short description when available. */
    readonly altText: string | null
    /** Attachment creation timestamp. */
    readonly createdAt: Date
}

// -----------------------------------------------
// Resolution
// -----------------------------------------------

/** Resolve a raw `attachment.transfer_state` code to a typed status. */
export function resolveTransferStatus(code: number | null): TransferStatus {
    switch (code) {
        case -1:
        case 0:
            return 'pending'
        case 1:
        case 2:
        case 3:
        case 4:
            return 'transferring'
        case 5:
            return 'complete'
        case 6:
        case 7:
            return 'failed'
        default:
            return 'unknown'
    }
}
