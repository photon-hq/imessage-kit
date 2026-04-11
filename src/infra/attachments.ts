/**
 * Read-only file operations on existing message attachments.
 *
 * Query-side helpers for working with attachment files already materialized
 * on disk. Intentionally separate from outbound attachment staging.
 */

import { access, copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, extname } from 'node:path'
import type { Attachment } from '../domain/attachment'

// -----------------------------------------------
// Types
// -----------------------------------------------

/** File metadata for an on-disk attachment. */
export interface AttachmentFileInfo {
    readonly localPath: string
    readonly size: number
    readonly createdAt: Date
    readonly modifiedAt: Date
}

// -----------------------------------------------
// Extension Sets
// -----------------------------------------------

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'heic', 'heif', 'webp', 'bmp', 'tiff', 'svg'])

const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'avi', 'mkv', 'm4v', 'wmv', 'flv', 'webm'])

const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg', 'wma'])

// -----------------------------------------------
// Internal
// -----------------------------------------------

function requireLocalPath(attachment: Attachment): string {
    if (!attachment.localPath) {
        throw new Error('Attachment does not have a local file path')
    }

    return attachment.localPath
}

// -----------------------------------------------
// File Operations
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

/** Copy the attachment file to a destination path, creating directories as needed. */
export async function copyAttachmentFile(attachment: Attachment, destPath: string): Promise<void> {
    const localPath = requireLocalPath(attachment)
    const destDir = dirname(destPath)
    await mkdir(destDir, { recursive: true })
    await copyFile(localPath, destPath)
}

/** Read the entire attachment file into a Buffer. */
export async function readAttachmentBytes(attachment: Attachment): Promise<Buffer> {
    return await readFile(requireLocalPath(attachment))
}

// -----------------------------------------------
// Metadata
// -----------------------------------------------

/** Get the file size in bytes (returns 0 if unavailable). */
export async function getAttachmentSize(attachment: Attachment): Promise<number> {
    const info = await getAttachmentFileInfo(attachment)
    return info?.size ?? 0
}

/** Get file metadata for an attachment, or null if the file is inaccessible. */
export async function getAttachmentFileInfo(attachment: Attachment): Promise<AttachmentFileInfo | null> {
    if (!attachment.localPath) return null

    try {
        const stats = await stat(attachment.localPath)

        return {
            localPath: attachment.localPath,
            size: stats.size,
            createdAt: stats.birthtime,
            modifiedAt: stats.mtime,
        }
    } catch {
        return null
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
