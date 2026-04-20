/**
 * Read-only helpers for existing message attachments.
 *
 * Keeps only platform-relevant helpers: existence check with
 * null-safe localPath, extension normalization, and type classification.
 * Use node:fs directly for copy/read/stat — they are trivial wrappers.
 */

import { access } from 'node:fs/promises'
import { extname } from 'node:path'
import type { Attachment } from '../domain/attachment'

// -----------------------------------------------
// Extension Sets
// -----------------------------------------------

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'heic', 'heif', 'webp', 'bmp', 'tiff', 'svg'])

const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'avi', 'mkv', 'm4v', 'wmv', 'flv', 'webm'])

const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg', 'wma'])

// -----------------------------------------------
// Existence
// -----------------------------------------------

/** Check whether the attachment file exists on disk. */
export async function attachmentExists(attachment: Attachment): Promise<boolean> {
    if (!attachment.localPath) return false

    try {
        await access(attachment.localPath)
        return true
    } catch {
        return false
    }
}

// -----------------------------------------------
// Type Detection
// -----------------------------------------------

/** Extract the lowercase file extension (without dot) from an attachment. */
export function getAttachmentExtension(attachment: Attachment): string {
    const ext = extname(attachment.fileName ?? attachment.localPath ?? '')
    return ext ? ext.slice(1).toLowerCase() : ''
}

/** Check whether the attachment is an image based on file extension. */
export function isImageAttachment(attachment: Attachment): boolean {
    return IMAGE_EXTENSIONS.has(getAttachmentExtension(attachment))
}

/** Check whether the attachment is a video based on file extension. */
export function isVideoAttachment(attachment: Attachment): boolean {
    return VIDEO_EXTENSIONS.has(getAttachmentExtension(attachment))
}

/** Check whether the attachment is audio based on file extension. */
export function isAudioAttachment(attachment: Attachment): boolean {
    return AUDIO_EXTENSIONS.has(getAttachmentExtension(attachment))
}
