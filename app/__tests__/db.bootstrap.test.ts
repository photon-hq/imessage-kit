import { describe, expect, it } from 'bun:test'
import { bootstrap, TAB_HEADERS } from '../src/db/bootstrap'
import { createMemoryClient } from '../src/db/sheets'

describe('bootstrap', () => {
    it('writes header rows when tabs are empty', async () => {
        const client = createMemoryClient({
            users: [],
            schedules: [],
            meal_events: [],
            knowledge: [],
        })
        await bootstrap(client)
        for (const [tab, headers] of Object.entries(TAB_HEADERS)) {
            const rows = await client.get(`${tab}!A:Z`)
            expect(rows[0]).toEqual(headers)
        }
    })

    it('is idempotent when headers already exist', async () => {
        const client = createMemoryClient({
            users: [TAB_HEADERS.users],
            schedules: [TAB_HEADERS.schedules],
            meal_events: [TAB_HEADERS.meal_events],
            knowledge: [TAB_HEADERS.knowledge],
        })
        await bootstrap(client)
        const users = await client.get('users!A:Z')
        expect(users).toHaveLength(1)
        expect(users[0]).toEqual(TAB_HEADERS.users)
    })

    it('throws on column drift', async () => {
        const client = createMemoryClient({
            users: [['handle', 'name']],
            schedules: [TAB_HEADERS.schedules],
            meal_events: [TAB_HEADERS.meal_events],
            knowledge: [TAB_HEADERS.knowledge],
        })
        await expect(bootstrap(client)).rejects.toThrow(/users.*header/i)
    })
})
