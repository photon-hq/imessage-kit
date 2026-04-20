/**
 * Runtime-agnostic SQLite adapter.
 *
 * Detects Bun vs Node at first use and caches the constructor.
 * Provides a minimal statement/adapter contract consumed by the reader.
 */

import { createRequire } from 'node:module'

import { DatabaseError, toError } from '../../domain/errors'
import type { QueryParam } from './contract'

const require = createRequire(import.meta.url)

// -----------------------------------------------
// Adapter interfaces
// -----------------------------------------------

/** Minimal prepared-statement contract shared by bun:sqlite and better-sqlite3. */
export interface SqliteStatement {
    readonly all: (...params: unknown[]) => Array<Record<string, unknown>>
}

/** Minimal database-handle contract shared by both runtimes. */
export interface SqliteAdapter {
    readonly prepare: (sql: string) => SqliteStatement
    readonly close: () => void
}

type SqliteAdapterCtor = new (path: string, options?: { readonly?: boolean }) => SqliteAdapter

// -----------------------------------------------
// Runtime resolution
// -----------------------------------------------

let cachedCtor: SqliteAdapterCtor | undefined

function loadModule<T>(specifier: string, extract: (mod: unknown) => T): T {
    try {
        return extract(require(specifier))
    } catch (error) {
        const cause = toError(error)
        throw DatabaseError(`Failed to load ${specifier}: ${cause.message}`, cause)
    }
}

function resolveCtor(): SqliteAdapterCtor {
    if (cachedCtor) return cachedCtor

    cachedCtor =
        typeof Bun !== 'undefined'
            ? loadModule('bun:sqlite', (m) => (m as { Database: SqliteAdapterCtor }).Database)
            : loadModule('better-sqlite3', (m) => {
                  const mod = m as SqliteAdapterCtor | { default: SqliteAdapterCtor }
                  return typeof mod === 'function' ? mod : mod.default
              })

    return cachedCtor
}

// -----------------------------------------------
// SqliteClient
// -----------------------------------------------

/** Low-level SQLite client with connection lifecycle and parameterised query execution. */
export class SqliteClient {
    protected readonly db: SqliteAdapter

    private closed = false

    /**
     * @param path      SQLite database file path.
     * @param readOnly  Open the database read-only. Defaults to `true` — writes to
     *                  `chat.db` would corrupt Messages.app state, so only flip this
     *                  when running against a test/fixture database.
     */
    constructor(path: string, readOnly = true) {
        const Ctor = resolveCtor()

        try {
            this.db = new Ctor(path, { readonly: readOnly })
        } catch (error) {
            const cause = toError(error)
            throw DatabaseError(`Failed to open database: ${cause.message}`, cause)
        }
    }

    protected all(sql: string, params: readonly QueryParam[] = []): Array<Record<string, unknown>> {
        if (this.closed) throw DatabaseError('Database is closed')

        try {
            return this.db.prepare(sql).all(...params)
        } catch (error) {
            const cause = toError(error)
            throw DatabaseError(`Query failed: ${cause.message}`, cause)
        }
    }

    close(): void {
        if (this.closed) return

        try {
            this.db.close()
        } catch (error) {
            const cause = toError(error)
            throw DatabaseError(`Failed to close database: ${cause.message}`, cause)
        }

        this.closed = true
    }
}
