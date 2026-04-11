import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

type Layer = 'application' | 'config' | 'domain' | 'index' | 'infra' | 'sdk' | 'sdk-bounds' | 'types' | 'utils'

interface Edge {
    readonly from: string
    readonly to: string
}

const SRC_ROOT = fileURLToPath(new URL('../src/', import.meta.url))
const FORBIDDEN_DIRECTORY_NAMES = new Set(['core', 'helpers', 'shared', 'tools'])
const ALLOWED_TOP_LEVEL_ENTRIES = [
    'application',
    'config.ts',
    'domain',
    'index.ts',
    'infra',
    'sdk-bounds.ts',
    'sdk.ts',
    'types',
    'utils',
]

function toPosixPath(value: string): string {
    return value.replaceAll('\\', '/')
}

function listTypeScriptFiles(dir: string): string[] {
    const results: string[] = []

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const absolute = join(dir, entry.name)

        if (entry.isDirectory()) {
            results.push(...listTypeScriptFiles(absolute))
            continue
        }

        if (entry.isFile() && absolute.endsWith('.ts')) {
            results.push(absolute)
        }
    }

    return results.sort()
}

function listDirectories(dir: string): string[] {
    const results: string[] = []

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue

        const absolute = join(dir, entry.name)
        results.push(absolute, ...listDirectories(absolute))
    }

    return results
}

function getRelativePath(absolute: string): string {
    return toPosixPath(relative(SRC_ROOT, absolute))
}

function collectModuleSpecifiers(absolute: string): string[] {
    const text = readFileSync(absolute, 'utf8')
    const source = ts.createSourceFile(absolute, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const specifiers: string[] = []

    const visit = (node: ts.Node) => {
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier != null &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            specifiers.push(node.moduleSpecifier.text)
        }

        ts.forEachChild(node, visit)
    }

    visit(source)

    return specifiers
}

function resolveInternalModule(fromAbsolute: string, specifier: string): string | null {
    if (!specifier.startsWith('.')) return null

    const base = resolve(dirname(fromAbsolute), specifier)
    const candidates = [base, `${base}.ts`, join(base, 'index.ts')]

    for (const candidate of candidates) {
        if (existsSync(candidate)) {
            return getRelativePath(candidate)
        }
    }

    throw new Error(`Unable to resolve internal module "${specifier}" from ${getRelativePath(fromAbsolute)}`)
}

function collectInternalEdges(): Edge[] {
    return listTypeScriptFiles(SRC_ROOT).flatMap((absolute) => {
        const from = getRelativePath(absolute)

        return collectModuleSpecifiers(absolute)
            .map((specifier) => resolveInternalModule(absolute, specifier))
            .filter((resolved): resolved is string => resolved != null)
            .map((to) => ({ from, to }))
    })
}

function getLayer(relativePath: string): Layer {
    if (relativePath === 'sdk.ts') return 'sdk'
    if (relativePath === 'index.ts') return 'index'
    if (relativePath === 'config.ts') return 'config'
    if (relativePath === 'sdk-bounds.ts') return 'sdk-bounds'
    if (relativePath.startsWith('application/')) return 'application'
    if (relativePath.startsWith('domain/')) return 'domain'
    if (relativePath.startsWith('infra/')) return 'infra'
    if (relativePath.startsWith('types/')) return 'types'
    if (relativePath.startsWith('utils/')) return 'utils'

    throw new Error(`Unclassified source file: ${relativePath}`)
}

function assertAllowedDependency(edge: Edge): void {
    const fromLayer = getLayer(edge.from)
    const toLayer = getLayer(edge.to)

    switch (fromLayer) {
        case 'types':
            if (toLayer !== 'types' && toLayer !== 'domain') {
                throw new Error(`types layer cannot depend on ${edge.to} (${edge.from} -> ${edge.to})`)
            }
            return

        case 'domain':
            if (toLayer !== 'domain' && toLayer !== 'types') {
                throw new Error(`domain layer cannot depend on ${edge.to} (${edge.from} -> ${edge.to})`)
            }
            return

        case 'application':
            if (toLayer !== 'application' && toLayer !== 'domain' && toLayer !== 'types') {
                throw new Error(`application layer cannot depend on ${edge.to} (${edge.from} -> ${edge.to})`)
            }
            return

        case 'infra':
            if (toLayer === 'application') {
                const allowedAppPorts = ['application/send-port.ts', 'application/message-dispatcher.ts']
                if (!allowedAppPorts.includes(edge.to)) {
                    throw new Error(`infra may only depend on application ports (${edge.from} -> ${edge.to})`)
                }
                return
            }

            if (toLayer !== 'infra' && toLayer !== 'domain' && toLayer !== 'types' && toLayer !== 'utils') {
                throw new Error(`infra layer cannot depend on ${edge.to} (${edge.from} -> ${edge.to})`)
            }
            return

        case 'utils':
            return

        case 'config':
            if (edge.to !== 'sdk-bounds.ts' && edge.to !== 'domain/validate.ts') {
                throw new Error(`config.ts may only re-export sdk bounds and send limits (${edge.from} -> ${edge.to})`)
            }
            return

        case 'sdk-bounds':
            throw new Error(`sdk-bounds.ts must not depend on internal modules (${edge.from} -> ${edge.to})`)

        case 'sdk':
            if (toLayer === 'index' || toLayer === 'config') {
                throw new Error(`sdk.ts must not depend on public/compat facades (${edge.from} -> ${edge.to})`)
            }
            return

        case 'index':
            return
    }
}

describe('Architecture Boundaries', () => {
    const tsFiles = listTypeScriptFiles(SRC_ROOT)
    const relativeFiles = tsFiles.map(getRelativePath)
    const internalEdges = collectInternalEdges()

    it('keeps the src top-level shape stable', () => {
        const actual = readdirSync(SRC_ROOT).sort()
        expect(actual).toEqual(ALLOWED_TOP_LEVEL_ENTRIES)
    })

    it('forbids generic bucket directories anywhere under src', () => {
        const forbidden = listDirectories(SRC_ROOT)
            .map(getRelativePath)
            .filter((relativePath) => FORBIDDEN_DIRECTORY_NAMES.has(relativePath.split('/').pop() ?? ''))

        expect(forbidden).toEqual([])
    })

    it('forbids internal barrel files', () => {
        const internalBarrels = relativeFiles.filter((file) => file.endsWith('/index.ts'))
        expect(internalBarrels).toEqual([])
    })

    it('enforces layer boundaries on all internal imports and re-exports', () => {
        for (const edge of internalEdges) {
            expect(() => assertAllowedDependency(edge)).not.toThrow()
        }
    })

    it('keeps root helper facades narrowly scoped', () => {
        const configImporters = internalEdges.filter((edge) => edge.to === 'config.ts').map((edge) => edge.from)
        const sdkBoundsImporters = internalEdges.filter((edge) => edge.to === 'sdk-bounds.ts').map((edge) => edge.from)

        expect(configImporters).toEqual(['index.ts'])
        expect(sdkBoundsImporters.sort()).toEqual(['config.ts', 'sdk.ts'])
    })
})
