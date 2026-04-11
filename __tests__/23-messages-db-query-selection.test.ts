import { describe, expect, it } from 'bun:test'
import { macos26Queries } from '../src/infra/db/macos26'
import { resolveSchemaId } from '../src/infra/db/reader'

describe('Messages DB Query Selection', () => {
    it('always resolves to macos26 schema', () => {
        expect(resolveSchemaId([])).toBe('macos26')
        expect(resolveSchemaId(['guid', 'ck_chat_id'])).toBe('macos26')
        expect(resolveSchemaId(['guid', 'text'])).toBe('macos26')
    })

    it('keeps the message query on a per-message chat lookup instead of globally grouping all chat joins', () => {
        const sql = macos26Queries.buildMessageQuery({ limit: 1 }).sql

        expect(sql).toContain('LEFT JOIN chat ON chat.ROWID = (')
        expect(sql).not.toContain('GROUP BY message_id')
    })

    it('builds chat summaries from a shared aggregate CTE instead of per-row subqueries', () => {
        const sql = macos26Queries.buildChatQuery({ kind: 'all', sortBy: 'recent' }).sql

        expect(sql).toContain('WITH chat_stats AS (')
        expect(sql).toContain('LEFT JOIN chat_stats ON chat_stats.chat_id = chat.ROWID')
        expect(sql).not.toContain('SELECT MAX(message.date)')
        expect(sql).not.toContain('SELECT COUNT(*)')
    })
})
