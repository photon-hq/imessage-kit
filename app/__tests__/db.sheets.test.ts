import { describe, expect, it } from 'bun:test'
import { createMemoryClient, type SheetsClient } from '../src/db/sheets'

describe('SheetsClient (memory impl)', () => {
    it('returns appended rows from get', async () => {
        const client: SheetsClient = createMemoryClient({ users: [['handle', 'name']] })
        await client.append('users!A:B', [['+14155550123', 'Alice']])
        const rows = await client.get('users!A:B')
        expect(rows).toEqual([['handle', 'name'], ['+14155550123', 'Alice']])
    })

    it('updates an existing row', async () => {
        const client = createMemoryClient({
            users: [['handle', 'name'], ['+14155550123', 'Alice']],
        })
        await client.update('users!A2:B2', [['+14155550123', 'Alicia']])
        const rows = await client.get('users!A:B')
        expect(rows[1]).toEqual(['+14155550123', 'Alicia'])
    })

    it('ensureTab creates a missing tab and is idempotent', async () => {
        const client = createMemoryClient()
        await client.ensureTab('users')
        expect(await client.get('users!A:Z')).toEqual([])
        await client.append('users!A:Z', [['handle']])
        await client.ensureTab('users')
        expect(await client.get('users!A:Z')).toEqual([['handle']])
    })

    it('caches reads for 15s but serves fresh data after write', async () => {
        const client = createMemoryClient({ users: [['h']] })
        const a = await client.get('users!A:A')
        await client.append('users!A:A', [['x']])
        const b = await client.get('users!A:A')
        expect(a).not.toBe(b)
        expect(b.length).toBe(2)
    })
})
