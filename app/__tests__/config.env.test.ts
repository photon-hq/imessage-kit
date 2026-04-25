import { describe, expect, it } from 'bun:test'
import { loadEnv } from '../src/config/env'

describe('loadEnv', () => {
    it('parses a complete environment', () => {
        const env = loadEnv({
            GEMINI_API_KEY: 'g',
            PHOTON_PROJECT_ID: 'p',
            PHOTON_PROJECT_SECRET: 's',
            GOOGLE_SHEET_ID: 'sheet',
            GOOGLE_SERVICE_ACCOUNT_JSON: '{"type":"service_account"}',
            NODE_ENV: 'test',
        })
        expect(env.geminiApiKey).toBe('g')
        expect(env.port).toBe(3000)
        expect(env.tz).toBe('America/New_York')
    })

    it('throws when GEMINI_API_KEY is missing', () => {
        expect(() =>
            loadEnv({
                PHOTON_PROJECT_ID: 'p',
                PHOTON_PROJECT_SECRET: 's',
                PHOTON_IMESSAGE_HANDLE: '+14155550123',
                PHOTON_WEBHOOK_SECRET: 'w',
                GOOGLE_SHEET_ID: 'sheet',
                GOOGLE_SERVICE_ACCOUNT_JSON: '{}',
            } as Record<string, string>)
        ).toThrow(/GEMINI_API_KEY/)
    })

    it('coerces PORT from string', () => {
        const env = loadEnv({
            GEMINI_API_KEY: 'g',
            PHOTON_PROJECT_ID: 'p',
            PHOTON_PROJECT_SECRET: 's',
            GOOGLE_SHEET_ID: 'sheet',
            GOOGLE_SERVICE_ACCOUNT_JSON: '{}',
            PORT: '8080',
        })
        expect(env.port).toBe(8080)
    })
})
