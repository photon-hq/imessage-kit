/**
 * Google Sheets client for the Penn Dining Agent.
 *
 * Three sheets:
 *   reviews           — community meal reviews
 *   pending_followups — scheduled follow-up message tracking
 *   conversation_state — per-user state machine
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { google } from 'googleapis'
import { SHEETS_CONFIG } from '../config.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Review {
    timestamp: string
    phoneHash: string
    venue: string
    date: string
    mealPeriod: string
    rating: number
    comment: string
    foodHighlights: string[]
}

export interface PendingFollowup {
    id: string
    phoneHash: string
    venue: string
    mealPeriod: string
    date: string
    scheduledFor: string
    status: 'pending' | 'sent' | 'responded'
}

export interface ConversationState {
    phoneHash: string
    state: 'idle' | 'awaiting_review'
    contextJson: string
    updatedAt: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function hashPhone(phone: string): string {
    return createHash('sha256').update(phone.replace(/\s/g, '')).digest('hex').slice(0, 16)
}

function rowToReview(row: string[]): Review {
    return {
        timestamp: row[0] ?? '',
        phoneHash: row[1] ?? '',
        venue: row[2] ?? '',
        date: row[3] ?? '',
        mealPeriod: row[4] ?? '',
        rating: Number(row[5] ?? 0),
        comment: row[6] ?? '',
        foodHighlights: (row[7] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    }
}

function rowToFollowup(row: string[]): PendingFollowup {
    return {
        id: row[0] ?? '',
        phoneHash: row[1] ?? '',
        venue: row[2] ?? '',
        mealPeriod: row[3] ?? '',
        date: row[4] ?? '',
        scheduledFor: row[5] ?? '',
        status: (row[6] ?? 'pending') as PendingFollowup['status'],
    }
}

function rowToState(row: string[]): ConversationState {
    return {
        phoneHash: row[0] ?? '',
        state: (row[1] ?? 'idle') as ConversationState['state'],
        contextJson: row[2] ?? '{}',
        updatedAt: row[3] ?? '',
    }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class SheetsClient {
    private spreadsheetId: string
    private sheets: ReturnType<typeof google.sheets>['spreadsheets']

    constructor() {
        this.spreadsheetId = SHEETS_CONFIG.spreadsheetId
        if (!this.spreadsheetId) {
            throw new Error('GOOGLE_SHEET_ID environment variable is not set')
        }

        const keyPath = resolve(
            process.env.GOOGLE_SERVICE_ACCOUNT_PATH ?? './service-account.json'
        )
        const key = JSON.parse(readFileSync(keyPath, 'utf-8'))

        const auth = new google.auth.GoogleAuth({
            credentials: key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        })

        const sheetsApi = google.sheets({ version: 'v4', auth })
        this.sheets = sheetsApi.spreadsheets
    }

    // -------------------------------------------------------------------------
    // Reviews
    // -------------------------------------------------------------------------

    async getReviews(venue?: string, mealPeriod?: string, limit = 20): Promise<Review[]> {
        const res = await this.sheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: `${SHEETS_CONFIG.reviewsSheet}!A2:H`,
        })
        const rows = (res.data.values ?? []) as string[][]
        let reviews = rows.map(rowToReview).filter((r) => r.timestamp)

        if (venue) {
            const lower = venue.toLowerCase()
            reviews = reviews.filter((r) => r.venue.toLowerCase().includes(lower))
        }
        if (mealPeriod) {
            const lower = mealPeriod.toLowerCase()
            reviews = reviews.filter((r) => r.mealPeriod.toLowerCase().includes(lower))
        }

        // Sort newest first, take limit
        return reviews.slice(-limit).reverse()
    }

    async appendReview(review: Omit<Review, 'timestamp'>): Promise<void> {
        const row = [
            new Date().toISOString(),
            review.phoneHash,
            review.venue,
            review.date,
            review.mealPeriod,
            String(review.rating),
            review.comment,
            review.foodHighlights.join(', '),
        ]
        await this.sheets.values.append({
            spreadsheetId: this.spreadsheetId,
            range: `${SHEETS_CONFIG.reviewsSheet}!A:H`,
            valueInputOption: 'RAW',
            requestBody: { values: [row] },
        })
    }

    // -------------------------------------------------------------------------
    // Pending Followups
    // -------------------------------------------------------------------------

    async getPendingFollowups(status?: PendingFollowup['status']): Promise<PendingFollowup[]> {
        const res = await this.sheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: `${SHEETS_CONFIG.followupsSheet}!A2:G`,
        })
        const rows = (res.data.values ?? []) as string[][]
        let followups = rows.map(rowToFollowup).filter((f) => f.id)
        if (status) {
            followups = followups.filter((f) => f.status === status)
        }
        return followups
    }

    async appendFollowup(followup: PendingFollowup): Promise<void> {
        const row = [
            followup.id,
            followup.phoneHash,
            followup.venue,
            followup.mealPeriod,
            followup.date,
            followup.scheduledFor,
            followup.status,
        ]
        await this.sheets.values.append({
            spreadsheetId: this.spreadsheetId,
            range: `${SHEETS_CONFIG.followupsSheet}!A:G`,
            valueInputOption: 'RAW',
            requestBody: { values: [row] },
        })
    }

    async updateFollowupStatus(id: string, status: PendingFollowup['status']): Promise<void> {
        const res = await this.sheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: `${SHEETS_CONFIG.followupsSheet}!A2:G`,
        })
        const rows = (res.data.values ?? []) as string[][]
        const rowIndex = rows.findIndex((r) => r[0] === id)
        if (rowIndex === -1) return

        const sheetRow = rowIndex + 2
        await this.sheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: `${SHEETS_CONFIG.followupsSheet}!G${sheetRow}`,
            valueInputOption: 'RAW',
            requestBody: { values: [[status]] },
        })
    }

    /** Get the most recent unanswered followup for a phone hash */
    async getPendingFollowupForPhone(phoneHash: string): Promise<PendingFollowup | null> {
        const followups = await this.getPendingFollowups('sent')
        const match = followups.filter((f) => f.phoneHash === phoneHash).pop()
        return match ?? null
    }

    // -------------------------------------------------------------------------
    // Conversation State
    // -------------------------------------------------------------------------

    async getState(phoneHash: string): Promise<ConversationState> {
        const res = await this.sheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: `${SHEETS_CONFIG.stateSheet}!A2:D`,
        })
        const rows = (res.data.values ?? []) as string[][]
        const row = rows.find((r) => r[0] === phoneHash)
        if (!row) {
            return { phoneHash, state: 'idle', contextJson: '{}', updatedAt: '' }
        }
        return rowToState(row)
    }

    async setState(
        phoneHash: string,
        state: ConversationState['state'],
        context: Record<string, unknown> = {}
    ): Promise<void> {
        const res = await this.sheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: `${SHEETS_CONFIG.stateSheet}!A2:D`,
        })
        const rows = (res.data.values ?? []) as string[][]
        const rowIndex = rows.findIndex((r) => r[0] === phoneHash)
        const updatedAt = new Date().toISOString()
        const newRow = [phoneHash, state, JSON.stringify(context), updatedAt]

        if (rowIndex === -1) {
            await this.sheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range: `${SHEETS_CONFIG.stateSheet}!A:D`,
                valueInputOption: 'RAW',
                requestBody: { values: [newRow] },
            })
        } else {
            const sheetRow = rowIndex + 2
            await this.sheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `${SHEETS_CONFIG.stateSheet}!A${sheetRow}:D${sheetRow}`,
                valueInputOption: 'RAW',
                requestBody: { values: [newRow] },
            })
        }
    }
}

/** Singleton instance — created lazily */
let _client: SheetsClient | null = null

export function getSheetsClient(): SheetsClient {
    if (!_client) {
        _client = new SheetsClient()
    }
    return _client
}
