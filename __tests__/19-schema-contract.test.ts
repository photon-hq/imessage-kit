import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import * as ts from 'typescript'

const messageText = readFileSync(new URL('../src/domain/message.ts', import.meta.url), 'utf8')
const chatText = readFileSync(new URL('../src/domain/chat.ts', import.meta.url), 'utf8')
const attachmentText = readFileSync(new URL('../src/domain/attachment.ts', import.meta.url), 'utf8')
const reactionText = readFileSync(new URL('../src/domain/reaction.ts', import.meta.url), 'utf8')
const mapperText = readFileSync(new URL('../src/infra/db/mapper.ts', import.meta.url), 'utf8')
const indexText = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')

function createSource(name: string, text: string) {
    return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

const sources = {
    message: createSource('domain/message.ts', messageText),
    chat: createSource('domain/chat.ts', chatText),
    attachment: createSource('domain/attachment.ts', attachmentText),
    reaction: createSource('domain/reaction.ts', reactionText),
    mapper: createSource('infra/db/mapper.ts', mapperText),
}

function findInterfaceIn(source: ts.SourceFile, name: string): ts.InterfaceDeclaration {
    let found: ts.InterfaceDeclaration | null = null

    const visit = (node: ts.Node) => {
        if (ts.isInterfaceDeclaration(node) && node.name.text === name) {
            found = node
            return
        }
        ts.forEachChild(node, visit)
    }

    visit(source)

    if (found == null) {
        throw new Error(`Interface not found: ${name}`)
    }

    return found
}

function getInterfaceProps(source: ts.SourceFile, name: string): string[] {
    return findInterfaceIn(source, name)
        .members.filter(ts.isPropertySignature)
        .map((member) => member.name.getText(source))
}

function getFunctionReturnProps(source: ts.SourceFile, name: string): string[] {
    let props: string[] | null = null

    const visit = (node: ts.Node) => {
        if (!ts.isFunctionDeclaration(node) || node.name?.getText(source) !== name) {
            ts.forEachChild(node, visit)
            return
        }

        const returnStatement = node.body?.statements.find(
            (statement): statement is ts.ReturnStatement =>
                ts.isReturnStatement(statement) &&
                statement.expression != null &&
                ts.isObjectLiteralExpression(statement.expression)
        )

        if (returnStatement?.expression == null || !ts.isObjectLiteralExpression(returnStatement.expression)) {
            throw new Error(`Function does not return an object literal: ${name}`)
        }

        props = returnStatement.expression.properties.flatMap((property) => {
            if (ts.isPropertyAssignment(property)) {
                return [property.name.getText(source)]
            }
            if (ts.isShorthandPropertyAssignment(property)) {
                return [property.name.getText(source)]
            }
            return []
        })
    }

    visit(source)

    if (props == null) {
        throw new Error(`Function not found: ${name}`)
    }

    return props
}

function sorted(values: readonly string[]): string[] {
    return [...values].sort()
}

describe('Schema Contract Audit', () => {
    it('defines all public primitive unions', () => {
        const primitiveTypes = [
            'Service',
            'ChatKind',
            'MessageKind',
            'ReactionKind',
            'TransferStatus',
            'ExpireStatus',
            'ShareActivity',
            'ShareDirection',
            'ScheduleKind',
            'ScheduleStatus',
        ]

        for (const name of primitiveTypes) {
            expect(indexText).toContain(name)
        }
    })

    it('defines and exports all public entity types', () => {
        const entities = ['Message', 'Chat', 'Attachment', 'Reaction']

        for (const name of entities) {
            expect(indexText).toContain(name)
        }
    })

    it('uses canonical friendly field names in public entities', () => {
        const forbidden = new Set([
            'guid',
            'displayName',
            'serviceName',
            'style',
            'attributedBody',
            'date',
            'dateDelivered',
            'dateRead',
            'dateEdited',
            'dateRetracted',
            'dateRecovered',
            'datePlayed',
            'associatedMessageType',
            'associatedMessageGuid',
            'associatedMessageEmoji',
            'associatedMessageRangeLocation',
            'associatedMessageRangeLength',
            'filename',
            'transferState',
            'transferName',
            'totalBytes',
            'sender',
            'isGroup',
            'chatStyle',
            'itemKind',
            'groupAction',
            'shareFlow',
        ])

        const checks: Array<[ts.SourceFile, string]> = [
            [sources.message, 'Message'],
            [sources.chat, 'Chat'],
            [sources.attachment, 'Attachment'],
            [sources.reaction, 'Reaction'],
        ]

        for (const [source, name] of checks) {
            for (const prop of getInterfaceProps(source, name)) {
                expect(forbidden.has(prop)).toBe(false)
            }
        }
    })

    it('keeps the shared semantic mapper aligned with the public interfaces', () => {
        const configs = [
            { fn: 'rowToAttachment', iface: 'Attachment', source: sources.attachment },
            { fn: 'rowToMessage', iface: 'Message', source: sources.message },
            { fn: 'rowToChat', iface: 'Chat', source: sources.chat },
        ] as const

        for (const { fn, iface, source } of configs) {
            expect(sorted(getFunctionReturnProps(sources.mapper, fn))).toEqual(sorted(getInterfaceProps(source, iface)))
        }
    })

    it('keeps the internal mapReaction helper aligned with the public Reaction interface', () => {
        // mapReaction is a private helper (not exported), so it isn't covered by the rowTo* alignment
        // check above. We assert its object-literal shape matches Reaction exactly so future additions
        // to the interface can't silently drop fields at the mapping boundary.
        const reactionFields = getFunctionReturnProps(sources.mapper, 'mapReaction')
        const reactionIface = getInterfaceProps(sources.reaction, 'Reaction')
        expect(sorted(reactionFields)).toEqual(sorted(reactionIface))
    })
})
