/**
 * Send Files Example
 *
 * Demonstrates sending various file types including:
 * - PDF documents
 * - CSV/Excel files
 * - Contact cards (.vcf)
 * - Any other file types
 *
 * Usage: bun run examples/send-files.ts [recipient]
 *
 * Examples:
 *   bun run examples/send-files.ts +1234567890
 *   bun run examples/send-files.ts user@example.com
 */

import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IMessageSDK } from '../src'

declare const process: any

const DEFAULT_RECIPIENT = '+1234567890'

/**
 * Get recipient from command line arguments
 */
function getRecipient(): string {
    if (typeof process !== 'undefined' && process.argv.length > 2) {
        return process.argv[2]
    }
    return DEFAULT_RECIPIENT
}

/**
 * Create a sample VCF (vCard) contact file
 */
function createSampleVCF(): string {
    const vcfContent = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:John Doe',
        'N:Doe;John;;;',
        'TEL;TYPE=CELL:+1234567890',
        'EMAIL:john.doe@example.com',
        'ORG:Example Company',
        'TITLE:Software Engineer',
        'END:VCARD',
    ].join('\n')

    const vcfPath = join(tmpdir(), 'contact-sample.vcf')
    writeFileSync(vcfPath, vcfContent, 'utf-8')
    return vcfPath
}

/**
 * Create a sample CSV file
 */
function createSampleCSV(): string {
    const csvContent = [
        'Name,Email,Phone',
        'Alice,alice@example.com,+1111111111',
        'Bob,bob@example.com,+2222222222',
        'Charlie,charlie@example.com,+3333333333',
    ].join('\n')

    const csvPath = join(tmpdir(), 'data-sample.csv')
    writeFileSync(csvPath, csvContent, 'utf-8')
    return csvPath
}

/**
 * Create a sample text document
 */
function createSampleDocument(): string {
    const content = [
        'Meeting Notes',
        '=============',
        '',
        `Date: ${new Date().toLocaleDateString()}`,
        'Attendees: Team Members',
        '',
        'Agenda:',
        '1. Project Status Review',
        '2. Q4 Goals Discussion',
        '3. Action Items',
        '',
        'Next Meeting: TBD',
    ].join('\n')

    const docPath = join(tmpdir(), 'meeting-notes.txt')
    writeFileSync(docPath, content, 'utf-8')
    return docPath
}

/**
 * Main test function
 */
async function test() {
    const recipient = getRecipient()

    console.log('Recipient:', recipient)
    console.log('Creating sample files...\n')

    const sdk = new IMessageSDK({
        debug: process.env.IMESSAGE_DEBUG === 'true',
    })

    try {
        // Create sample files
        const vcfFile = createSampleVCF()
        const csvFile = createSampleCSV()
        const docFile = createSampleDocument()

        console.log('Sample files created:')
        console.log(`  - Contact Card: ${vcfFile}`)
        console.log(`  - CSV Data: ${csvFile}`)
        console.log(`  - Text Document: ${docFile}`)
        console.log()

        // Example 1: Send a single file with sendFile()
        console.log('Example 1: Sending contact card...')
        await sdk.sendFile(recipient, vcfFile, "Here is John's contact info")
        console.log('✓ Contact card sent\n')

        // Wait between sends
        await new Promise((r) => setTimeout(r, 2000))

        // Example 2: Send multiple files with sendFiles()
        console.log('Example 2: Sending multiple files...')
        await sdk.sendFiles(recipient, [csvFile, docFile], 'Here are the meeting notes and data')
        console.log('✓ Multiple files sent\n')

        // Wait between sends
        await new Promise((r) => setTimeout(r, 2000))

        // Example 3: Send files using the generic send() method
        console.log('Example 3: Using send() with files parameter...')
        await sdk.send(recipient, {
            text: 'Quick file share',
            files: [docFile],
        })
        console.log('✓ File sent via send() method\n')

        // Wait between sends
        await new Promise((r) => setTimeout(r, 2000))

        // Example 4: Mix images and files
        console.log('Example 4: Mixing images and files...')
        // Note: You need to provide actual image paths for this to work
        // await sdk.send(recipient, {
        //     text: 'Project files and screenshots',
        //     images: ['/path/to/screenshot.png'],
        //     files: [csvFile, docFile]
        // })
        console.log('(Skipped - provide actual image paths to test)')
        console.log()

        // Example 5: Batch send files to multiple recipients
        console.log('Example 5: Batch sending (demo only)...')
        // await sdk.sendBatch([
        //     { to: recipient, content: { text: 'Contact card', files: [vcfFile] } },
        //     { to: recipient, content: { text: 'Data file', files: [csvFile] } }
        // ])
        console.log('(Skipped - uncomment to test batch sending)')
        console.log()

        console.log('All examples completed successfully! ✨')
        console.log('\nNote: Check your Messages app to see the sent files.')
        console.log('Files are automatically uploaded to iCloud if iMessage is enabled.')
    } catch (error) {
        console.error('Test failed:', error)
        throw error
    } finally {
        await sdk.close()
    }
}

test().catch((error) => {
    console.error('Error:', error)
    if (typeof process !== 'undefined') {
        process.exit(1)
    }
})
