/**
 * Network image download and format conversion
 * - Downloads images to temp directory
 * - Converts AVIF/WebP to JPEG for iMessage compatibility
 */

import { execFile } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { SendError } from '../core/errors'
import { delay } from './common'

const execFileAsync = promisify(execFile)
const TEMP_DIR = join(homedir(), 'Pictures')

interface DownloadOptions {
    timeout?: number // Default: 15000ms
    maxRetries?: number // Default: 2
    retryDelay?: number // Default: 1000ms
    debug?: boolean
}

/** Convert image to JPEG using macOS sips command */
const convertImageToJPEG = async (inputPath: string, outputPath?: string): Promise<string> => {
    const output = outputPath || join(TEMP_DIR, `imsg_temp_${Date.now()}.jpg`)

    try {
        // Use execFile to avoid shell interpolation (security fix)
        await execFileAsync('sips', ['-s', 'format', 'jpeg', inputPath, '--out', output], { timeout: 10000 })

        if (!existsSync(output)) {
            throw new Error('Converted file does not exist')
        }

        return output
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        throw SendError(`Image format conversion failed: ${msg}`)
    }
}

/**
 * Download network image with automatic format conversion
 * @throws SendError when download fails after retries
 */
export const downloadImage = async (url: string, options: DownloadOptions = {}): Promise<string> => {
    const { timeout = 15000, maxRetries = 2, retryDelay = 1000, debug = false } = options
    let lastError: Error | null = null

    if (debug) {
        console.log(`[Download] ${url.length > 60 ? `${url.slice(0, 60)}...` : url}`)
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 0) {
                await delay(retryDelay * 2 ** (attempt - 1))
            }

            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), timeout)

            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                },
            })

            clearTimeout(timeoutId)

            if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`)
            }

            const contentType = response.headers.get('content-type')?.toLowerCase() || ''
            const buffer = Buffer.from(await response.arrayBuffer())

            // Handle AVIF/WebP - convert to JPEG
            if (contentType.includes('avif') || contentType.includes('webp')) {
                const ext = contentType.includes('avif') ? '.avif' : '.webp'
                const tempPath = join(TEMP_DIR, `imsg_temp_${Date.now()}${ext}`)
                writeFileSync(tempPath, buffer)

                const converted = await convertImageToJPEG(tempPath)
                if (debug) {
                    console.log(`[Download] Converted ${ext} -> .jpg`)
                }
                return converted
            }

            // Detect extension for other formats
            const extMap: Record<string, string> = {
                png: '.png',
                gif: '.gif',
                svg: '.svg',
                bmp: '.bmp',
            }
            const ext = Object.entries(extMap).find(([key]) => contentType.includes(key))?.[1] || '.jpg'

            const path = join(TEMP_DIR, `imsg_temp_${Date.now()}${ext}`)
            writeFileSync(path, buffer)
            return path
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error))

            if (lastError.name === 'AbortError') {
                lastError = new Error(`Request timeout (${timeout}ms)`)
            }

            if (attempt === maxRetries) {
                throw SendError(`Download failed (${maxRetries + 1} attempts): ${lastError.message}\nURL: ${url}`)
            }

            if (debug && attempt > 0) {
                console.warn(`[Download] Retry ${attempt + 1}/${maxRetries + 1}: ${lastError.message}`)
            }
        }
    }

    throw SendError(`Download failed: ${lastError?.message}`)
}

/**
 * Convert AVIF/WebP images to JPEG for iMessage compatibility
 * @returns {path, converted} - Returns original path if no conversion needed
 */
export const convertToCompatibleFormat = async (filePath: string): Promise<{ path: string; converted: boolean }> => {
    const ext = filePath.split('.').pop()?.toLowerCase()

    if (!ext || !['avif', 'webp'].includes(ext)) {
        return { path: filePath, converted: false }
    }

    const fileName = filePath
        .split('/')
        .pop()!
        .replace(/\.(avif|webp)$/i, '.jpg')
    const isOurTemp = fileName.startsWith('imsg_temp_')
    const output = isOurTemp ? join(TEMP_DIR, fileName) : join(TEMP_DIR, `imsg_temp_${Date.now()}_${fileName}`)

    const converted = await convertImageToJPEG(filePath, output)
    return { path: converted, converted: true }
}
