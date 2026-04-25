import { google, type sheets_v4 } from 'googleapis'

export type Row = string[]

export interface SheetsClient {
    get(range: string): Promise<Row[]>
    append(range: string, rows: Row[]): Promise<void>
    update(range: string, rows: Row[]): Promise<void>
    clear(range: string): Promise<void>
    ensureTab(name: string): Promise<void>
    invalidate(range?: string): void
}

interface CacheEntry {
    at: number
    rows: Row[]
}

const CACHE_TTL_MS = 15_000

function rangeSheet(range: string): string {
    return range.split('!')[0] ?? range
}

export function createGoogleSheetsClient(spreadsheetId: string, serviceAccountJson: string): SheetsClient {
    let credentials: Record<string, unknown>
    try {
        credentials = JSON.parse(serviceAccountJson) as Record<string, unknown>
    } catch (err) {
        throw new Error(
            `GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        )
    }
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })
    const sheets = google.sheets({ version: 'v4', auth }) as sheets_v4.Sheets

    const cache = new Map<string, CacheEntry>()

    function invalidate(range?: string): void {
        if (!range) {
            cache.clear()
            return
        }
        const sheet = rangeSheet(range)
        for (const k of [...cache.keys()]) {
            if (rangeSheet(k) === sheet) cache.delete(k)
        }
    }

    return {
        async get(range) {
            const hit = cache.get(range)
            if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rows
            const res = await sheets.spreadsheets.values.get({ spreadsheetId, range })
            const rows = (res.data.values ?? []).map((r) => r.map((c) => String(c ?? '')))
            cache.set(range, { at: Date.now(), rows })
            return rows
        },
        async append(range, rows) {
            await sheets.spreadsheets.values.append({
                spreadsheetId,
                range,
                valueInputOption: 'RAW',
                requestBody: { values: rows },
            })
            invalidate(range)
        },
        async update(range, rows) {
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range,
                valueInputOption: 'RAW',
                requestBody: { values: rows },
            })
            invalidate(range)
        },
        async clear(range) {
            await sheets.spreadsheets.values.clear({ spreadsheetId, range })
            invalidate(range)
        },
        async ensureTab(name) {
            const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false })
            const titles = (meta.data.sheets ?? [])
                .map((s) => s.properties?.title)
                .filter((t): t is string => typeof t === 'string')
            if (titles.includes(name)) return
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{ addSheet: { properties: { title: name } } }],
                },
            })
        },
        invalidate,
    }
}

export function createMemoryClient(initial: Record<string, Row[]> = {}): SheetsClient {
    const tabs = new Map<string, Row[]>()
    for (const [k, v] of Object.entries(initial)) tabs.set(k, v.map((r) => [...r]))

    function parseRange(range: string): { tab: string; startRow?: number; endRow?: number } {
        const [tab, spec] = range.split('!')
        if (!tab) throw new Error(`Invalid range: ${range}`)
        if (!spec) return { tab }
        const match = spec.match(/^[A-Z]+(\d+)?(:[A-Z]+(\d+)?)?$/)
        if (!match) return { tab }
        const startRow = match[1] ? Number(match[1]) : undefined
        const endRow = match[3] ? Number(match[3]) : undefined
        return { tab, startRow, endRow }
    }

    return {
        async get(range) {
            const { tab, startRow, endRow } = parseRange(range)
            const rows = tabs.get(tab) ?? []
            if (startRow == null) return rows.map((r) => [...r])
            const start = startRow - 1
            const end = endRow ?? rows.length
            return rows.slice(start, end).map((r) => [...r])
        },
        async append(range, rows) {
            const { tab } = parseRange(range)
            const existing = tabs.get(tab) ?? []
            tabs.set(tab, [...existing, ...rows.map((r) => [...r])])
        },
        async update(range, rows) {
            const { tab, startRow } = parseRange(range)
            if (startRow == null) throw new Error(`Update range needs row: ${range}`)
            const existing = tabs.get(tab) ?? []
            for (let i = 0; i < rows.length; i++) {
                existing[startRow - 1 + i] = [...rows[i]!]
            }
            tabs.set(tab, existing)
        },
        async clear(range) {
            const { tab } = parseRange(range)
            tabs.set(tab, [])
        },
        async ensureTab(name) {
            if (!tabs.has(name)) tabs.set(name, [])
        },
        invalidate() {},
    }
}
