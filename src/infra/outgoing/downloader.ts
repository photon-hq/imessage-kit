/**
 * Outbound attachment preparation.
 *
 * Downloads remote images to secure temp files and converts
 * unsupported formats (AVIF, WebP) to JPEG via macOS sips.
 */

import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'

import { SendError, toErrorMessage } from '../../domain/errors'
import { retry } from '../../utils/async'

const execFileAsync = promisify(execFile)

const TEMP_DIR = join(homedir(), 'Pictures')
const MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024

// -----------------------------------------------
// Helpers
// -----------------------------------------------

function generateSecureFilename(ext: string): string {
    return `imsg_temp_${randomBytes(8).toString('hex')}${ext}`
}

function redactUrlForLogs(url: string): string {
    try {
        const parsed = new URL(url)
        const pathname = parsed.pathname.length > 80 ? `${parsed.pathname.slice(0, 80)}...` : parsed.pathname
        return `${parsed.origin}${pathname}`
    } catch {
        return url.length > 120 ? `${url.slice(0, 120)}...` : url
    }
}

function isSupportedImageContentType(contentType: string): boolean {
    return contentType.startsWith('image/') || contentType.startsWith('application/octet-stream') || contentType === ''
}

async function convertImageToJPEG(inputPath: string, outputPath?: string): Promise<string> {
    const output = outputPath || join(TEMP_DIR, generateSecureFilename('.jpg'))

    try {
        await execFileAsync('sips', ['-s', 'format', 'jpeg', inputPath, '--out', output], {
            timeout: 10_000,
        })

        if (!existsSync(output)) {
            throw new Error('Converted file does not exist')
        }

        return output
    } catch (error) {
        throw SendError(`Image format conversion failed: ${toErrorMessage(error)}`)
    }
}

// -----------------------------------------------
// Public API
// -----------------------------------------------

/** Options for downloading a remote image. */
export interface DownloadOptions {
    readonly timeout?: number
    readonly maxRetries?: number
    readonly retryDelay?: number
    readonly maxSize?: number
    readonly debug?: boolean
    readonly signal?: AbortSignal
}

/**
 * Download a remote image with retry and automatic format conversion.
 *
 * Saves to ~/Pictures/imsg_temp_<random>.<ext> with secure file creation.
 *
 * @throws IMessageError with code SEND when download fails after retries
 */
export async function downloadImage(url: string, options: DownloadOptions = {}): Promise<string> {
    const {
        timeout = 15_000,
        maxRetries = 2,
        retryDelay = 1_000,
        maxSize = MAX_DOWNLOAD_SIZE,
        debug = false,
        signal,
    } = options
    const safeUrl = redactUrlForLogs(url)

    if (debug) {
        console.log(`[Download] ${safeUrl}`)
    }

    try {
        return await retry(() => fetchAndSave(url, timeout, maxSize, debug, signal), {
            attempts: maxRetries + 1,
            delay: retryDelay,
            backoff: true,
            signal,
        })
    } catch (error) {
        throw SendError(`Download failed (${maxRetries + 1} attempts): ${toErrorMessage(error)}\nURL: ${safeUrl}`)
    }
}

/**
 * Convert AVIF or WebP images to JPEG for iMessage compatibility.
 *
 * Returns the original path unchanged if no conversion is needed.
 */
export async function convertToCompatibleFormat(
    filePath: string
): Promise<{ readonly path: string; readonly converted: boolean }> {
    const ext = extname(filePath).slice(1).toLowerCase()

    if (!ext || !['avif', 'webp'].includes(ext)) {
        return { path: filePath, converted: false }
    }

    const tail = basename(filePath)
    if (!tail) {
        return { path: filePath, converted: false }
    }

    const fileName = tail.replace(/\.(avif|webp)$/i, '.jpg')

    const isOurTemp = fileName.startsWith('imsg_temp_')
    const output = isOurTemp ? join(TEMP_DIR, fileName) : join(TEMP_DIR, generateSecureFilename('.jpg'))

    const converted = await convertImageToJPEG(filePath, output)

    return { path: converted, converted: true }
}

// -----------------------------------------------
// Internal
// -----------------------------------------------

async function fetchAndSave(
    url: string,
    timeout: number,
    maxSize: number,
    debug: boolean,
    signal?: AbortSignal
): Promise<string> {
    const fetchSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)

    const response = await fetch(url, {
        signal: fetchSignal,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
        },
    })

    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`)
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength && Number.parseInt(contentLength, 10) > maxSize) {
        throw new Error(`File too large: ${contentLength} bytes (max ${maxSize})`)
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() || ''

    if (!isSupportedImageContentType(contentType)) {
        throw new Error(`Unsupported content type: ${contentType}`)
    }

    const buffer = await readResponseWithLimit(response, maxSize)

    if (contentType.includes('avif') || contentType.includes('webp')) {
        const ext = contentType.includes('avif') ? '.avif' : '.webp'
        const tempPath = join(TEMP_DIR, generateSecureFilename(ext))
        writeFileSync(tempPath, buffer, { flag: 'wx', mode: 0o600 })

        let converted: string
        try {
            converted = await convertImageToJPEG(tempPath)
        } catch (error) {
            try {
                unlinkSync(tempPath)
            } catch {}
            throw error
        }

        try {
            unlinkSync(tempPath)
        } catch {}

        if (debug) console.log(`[Download] Converted ${ext} -> .jpg`)

        return converted
    }

    const extMap: Record<string, string> = { png: '.png', gif: '.gif', svg: '.svg', bmp: '.bmp' }
    const ext = Object.entries(extMap).find(([key]) => contentType.includes(key))?.[1] || '.jpg'
    const path = join(TEMP_DIR, generateSecureFilename(ext))
    writeFileSync(path, buffer, { flag: 'wx', mode: 0o600 })

    return path
}

async function readResponseWithLimit(response: Response, maxSize: number): Promise<Buffer> {
    if (!response.body) {
        const ab = await response.arrayBuffer()
        if (ab.byteLength > maxSize) throw new Error(`Download exceeded max size (${maxSize} bytes)`)
        return Buffer.from(ab)
    }

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let totalBytes = 0

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            totalBytes += value.byteLength
            if (totalBytes > maxSize) {
                reader.cancel()
                throw new Error(`Download exceeded max size (${maxSize} bytes)`)
            }

            chunks.push(value)
        }
    } finally {
        reader.releaseLock()
    }

    return Buffer.concat(chunks)
}
