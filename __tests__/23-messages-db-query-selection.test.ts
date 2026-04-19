import { describe, expect, it } from 'bun:test'
import { macos26Queries } from '../src/infra/db/macos26'

describe('Messages DB Query Selection', () => {
    it('keeps the message query on a per-message chat lookup instead of globally grouping all chat joins', () => {
        const sql = macos26Queries.buildMessageQuery({ limit: 1 }).sql

        expect(sql).toContain('LEFT JOIN chat ON chat.ROWID = (')
        expect(sql).not.toContain('GROUP BY message_id')
    })

    it('builds chat summaries from a shared aggregate CTE instead of per-row subqueries', () => {
        const sql = macos26Queries.buildChatQuery({ sortBy: 'recent' }).sql

        expect(sql).toContain('WITH chat_stats AS (')
        expect(sql).toContain('LEFT JOIN chat_stats ON chat_stats.chat_id = chat.ROWID')
        expect(sql).not.toContain('SELECT MAX(message.date)')
        expect(sql).not.toContain('SELECT COUNT(*)')
    })

    it('appends each message filter as a WHERE clause with the matching bound param', () => {
        const since = new Date('2024-01-01T00:00:00Z')
        const before = new Date('2024-06-01T00:00:00Z')
        const { sql, params } = macos26Queries.buildMessageQuery({
            participant: '+1234567890',
            service: 'SMS',
            isFromMe: true,
            isRead: false,
            hasAttachments: true,
            excludeReactions: true,
            since,
            before,
            sinceRowId: 42,
        })

        expect(sql).toContain('handle.id = ?')
        expect(sql).toContain('message.service = ?')
        expect(sql).toContain('message.is_from_me = 1')
        expect(sql).toContain('message.is_read = 0')
        expect(sql).toContain('EXISTS (SELECT 1 FROM message_attachment_join')
        expect(sql).toContain('message.associated_message_type IS NULL OR message.associated_message_type = 0')
        expect(sql).toContain('message.ROWID > ?')
        expect(sql).toContain('message.date >= ?')
        expect(sql).toContain('message.date < ?')
        // Param order must follow the order clauses are appended.
        expect(params).toEqual([
            '+1234567890',
            'SMS',
            42,
            // since/before are Mac timestamps (ns); check they are finite numbers.
            expect.any(Number),
            expect.any(Number),
        ])
    })

    it('omits LIMIT when neither limit nor offset is provided, and injects LIMIT -1 for offset-only', () => {
        const noPaging = macos26Queries.buildMessageQuery({})
        expect(noPaging.sql).not.toMatch(/LIMIT/)

        const offsetOnly = macos26Queries.buildMessageQuery({ offset: 20 })
        // SQLite requires a LIMIT clause whenever OFFSET is present.
        expect(offsetOnly.sql).toContain('LIMIT -1')
        expect(offsetOnly.sql).toContain('OFFSET ?')
        expect(offsetOnly.params).toEqual([20])

        const bothPaging = macos26Queries.buildMessageQuery({ limit: 10, offset: 30 })
        expect(bothPaging.sql).toContain('LIMIT ?')
        expect(bothPaging.sql).toContain('OFFSET ?')
        expect(bothPaging.params).toEqual([10, 30])
    })

    it('hasAttachments=false uses NOT EXISTS for the attachment-absent branch', () => {
        const sql = macos26Queries.buildMessageQuery({ hasAttachments: false }).sql
        expect(sql).toContain('NOT EXISTS (SELECT 1 FROM message_attachment_join')
    })

    it('orderByRowIdAsc switches the ORDER BY from message.date DESC to message.ROWID ASC', () => {
        const asc = macos26Queries.buildMessageQuery({ orderByRowIdAsc: true }).sql
        expect(asc).toContain('ORDER BY message.ROWID ASC')
        expect(asc).not.toContain('ORDER BY message.date DESC')

        const desc = macos26Queries.buildMessageQuery({}).sql
        expect(desc).toContain('ORDER BY message.date DESC')
    })

    it('buildChatQuery emits one WHERE predicate per filter (kind / service / isArchived) with matching params', () => {
        const kindOnly = macos26Queries.buildChatQuery({ kind: 'group' })
        expect(kindOnly.sql).toContain('style = ?')
        // style comparison is param-based so the filter value travels in params, not SQL.
        expect(kindOnly.params).toHaveLength(1)

        const kindDm = macos26Queries.buildChatQuery({ kind: 'dm' })
        expect(kindDm.sql).toContain('style = ?')
        expect(kindDm.params).toHaveLength(1)
        expect(kindDm.params[0]).not.toBe(kindOnly.params[0]) // DM and group styles differ

        const serviceOnly = macos26Queries.buildChatQuery({ service: 'SMS' })
        expect(serviceOnly.sql).toContain('service_name = ?')
        expect(serviceOnly.params).toEqual(['SMS'])

        const archivedTrue = macos26Queries.buildChatQuery({ isArchived: true })
        expect(archivedTrue.sql).toContain('is_archived = 1')

        const archivedFalse = macos26Queries.buildChatQuery({ isArchived: false })
        expect(archivedFalse.sql).toContain('is_archived = 0')
    })

    it('buildChatQuery ORDER BY switches between recent (last_date DESC) and name (display_name ASC)', () => {
        const recent = macos26Queries.buildChatQuery({ sortBy: 'recent' }).sql
        expect(recent).toContain('ORDER BY (last_date IS NULL), last_date DESC')
        expect(recent).not.toContain('display_name ASC')

        const name = macos26Queries.buildChatQuery({ sortBy: 'name' }).sql
        expect(name).toContain('ORDER BY (display_name IS NULL), display_name ASC')
        expect(name).not.toContain('last_date DESC')

        const neither = macos26Queries.buildChatQuery({}).sql
        expect(neither).not.toMatch(/ORDER BY/)
    })

    it('treats limit: 0 as "no limit" rather than emitting LIMIT 0', () => {
        const noLimit = macos26Queries.buildMessageQuery({ limit: 0 })
        expect(noLimit.sql).not.toMatch(/LIMIT/)
        expect(noLimit.params).toEqual([])

        const chatNoLimit = macos26Queries.buildChatQuery({ limit: 0 })
        expect(chatNoLimit.sql).not.toMatch(/LIMIT/)
        expect(chatNoLimit.params).toEqual([])
    })

    it('chat query search LIKE pattern escapes %, _, and backslash so user input cannot widen the match', () => {
        const { sql, params } = macos26Queries.buildChatQuery({ search: '50% off\\_deal', sortBy: 'name' })
        expect(sql).toContain("display_name LIKE ? ESCAPE '\\'")
        expect(sql).toContain("chat_identifier LIKE ? ESCAPE '\\'")
        // Each of %, _, \ becomes \<ch>, wrapped by literal % markers for the LIKE span.
        expect(params[0]).toBe('%50\\% off\\\\\\_deal%')
        expect(params[1]).toBe('%50\\% off\\\\\\_deal%')
    })
})
