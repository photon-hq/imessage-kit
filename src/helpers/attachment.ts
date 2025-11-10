/**
 * Attachment Helper Functions
 *
 * Provides utility functions for working with message attachments
 * without adding methods to the Attachment interface (keeping it as pure data)
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Attachment } from '../types/message'

/** Supported image file extensions */
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'heic', 'heif', 'webp', 'bmp', 'tiff', 'svg'] as const

/** Supported video file extensions */
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'm4v', 'wmv', 'flv', 'webm'] as const

/** Supported audio file extensions */
const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg', 'wma'] as const

/**
 * Check if attachment file exists on disk
 *
 * @param attachment Attachment object
 * @returns True if file exists, false otherwise
 *
 * @example
 * ```ts
 * import { attachmentExists } from '@photon-ai/imessage-kit/helpers'
 *
 * const attachment = message.attachments[0]
 * if (await attachmentExists(attachment)) {
 *   console.log('Attachment exists')
 * }
 * ```
 */
export async function attachmentExists(attachment: Attachment): Promise<boolean> {
    try {
        await fs.promises.access(attachment.path, fs.constants.F_OK)
        return true
    } catch {
        return false
    }
}

/**
 * Download (copy) attachment to specified destination
 *
 * @param attachment Attachment object
 * @param destPath Destination file path
 * @throws Error if source file doesn't exist or copy fails
 *
 * @example
 * ```ts
 * import { downloadAttachment } from '@photon-ai/imessage-kit/helpers'
 *
 * const attachment = message.attachments[0]
 * await downloadAttachment(attachment, '/path/to/save/file.jpg')
 * ```
 */
export async function downloadAttachment(attachment: Attachment, destPath: string): Promise<void> {
    // Ensure destination directory exists
    const destDir = path.dirname(destPath)
    await fs.promises.mkdir(destDir, { recursive: true })

    // Copy file
    await fs.promises.copyFile(attachment.path, destPath)
}

/**
 * Get attachment file size in bytes
 *
 * @param attachment Attachment object
 * @returns File size in bytes, or 0 if file doesn't exist
 *
 * @example
 * ```ts
 * import { getAttachmentSize } from '@photon-ai/imessage-kit/helpers'
 *
 * const size = await getAttachmentSize(attachment)
 * console.log(`File size: ${(size / 1024 / 1024).toFixed(2)} MB`)
 * ```
 */
export async function getAttachmentSize(attachment: Attachment): Promise<number> {
    try {
        const stats = await fs.promises.stat(attachment.path)
        return stats.size
    } catch {
        return 0
    }
}

/**
 * Get attachment metadata (size, modified time, etc.)
 *
 * @param attachment Attachment object
 * @returns File stats or null if file doesn't exist
 *
 * @example
 * ```ts
 * import { getAttachmentMetadata } from '@photon-ai/imessage-kit/helpers'
 *
 * const metadata = await getAttachmentMetadata(attachment)
 * if (metadata) {
 *   console.log(`Size: ${metadata.size}, Modified: ${metadata.mtime}`)
 * }
 * ```
 */
export async function getAttachmentMetadata(attachment: Attachment): Promise<fs.Stats | null> {
    try {
        return await fs.promises.stat(attachment.path)
    } catch {
        return null
    }
}

/**
 * Read attachment content as Buffer
 *
 * Useful for processing file contents without saving to disk
 *
 * @param attachment Attachment object
 * @returns File content as Buffer
 * @throws Error if file doesn't exist or read fails
 *
 * @example
 * ```ts
 * import { readAttachment } from '@photon-ai/imessage-kit/helpers'
 *
 * const buffer = await readAttachment(attachment)
 * // Process buffer...
 * ```
 */
export async function readAttachment(attachment: Attachment): Promise<Buffer> {
    return await fs.promises.readFile(attachment.path)
}

/**
 * Get attachment file extension
 *
 * @param attachment Attachment object
 * @returns File extension (without dot) or empty string
 *
 * @example
 * ```ts
 * import { getAttachmentExtension } from '@photon-ai/imessage-kit/helpers'
 *
 * const ext = getAttachmentExtension(attachment)
 * if (ext === 'jpg' || ext === 'png') {
 *   console.log('Image file')
 * }
 * ```
 */
export function getAttachmentExtension(attachment: Attachment): string {
    const ext = path.extname(attachment.path)
    return ext ? ext.slice(1).toLowerCase() : ''
}

/**
 * Check if attachment is an image
 *
 * @param attachment Attachment object
 * @returns True if attachment is an image file
 *
 * @example
 * ```ts
 * import { isImageAttachment } from '@photon-ai/imessage-kit/helpers'
 *
 * if (isImageAttachment(attachment)) {
 *   console.log('This is an image')
 * }
 * ```
 */
export function isImageAttachment(attachment: Attachment): boolean {
    const ext = getAttachmentExtension(attachment)
    return IMAGE_EXTENSIONS.includes(ext as any)
}

/**
 * Check if attachment is a video
 *
 * @param attachment Attachment object
 * @returns True if attachment is a video file
 */
export function isVideoAttachment(attachment: Attachment): boolean {
    const ext = getAttachmentExtension(attachment)
    return VIDEO_EXTENSIONS.includes(ext as any)
}

/**
 * Check if attachment is an audio file
 *
 * @param attachment Attachment object
 * @returns True if attachment is an audio file
 */
export function isAudioAttachment(attachment: Attachment): boolean {
    const ext = getAttachmentExtension(attachment)
    return AUDIO_EXTENSIONS.includes(ext as any)
}
