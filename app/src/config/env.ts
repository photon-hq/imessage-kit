import { z } from 'zod'

const envSchema = z.object({
    GEMINI_API_KEY: z.string().min(1),
    PHOTON_PROJECT_ID: z.string().min(1),
    PHOTON_PROJECT_SECRET: z.string().min(1),
    GOOGLE_SHEET_ID: z.string().min(1),
    GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(1),
    PORT: z.coerce.number().int().positive().default(3000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

export interface Env {
    geminiApiKey: string
    photonProjectId: string
    photonProjectSecret: string
    googleSheetId: string
    googleServiceAccountJson: string
    port: number
    nodeEnv: 'development' | 'production' | 'test'
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
    const parsed = envSchema.safeParse(source)
    if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        throw new Error(`Invalid environment: ${issues}`)
    }
    const e = parsed.data
    return {
        geminiApiKey: e.GEMINI_API_KEY,
        photonProjectId: e.PHOTON_PROJECT_ID,
        photonProjectSecret: e.PHOTON_PROJECT_SECRET,
        googleSheetId: e.GOOGLE_SHEET_ID,
        googleServiceAccountJson: e.GOOGLE_SERVICE_ACCOUNT_JSON,
        port: e.PORT,
        nodeEnv: e.NODE_ENV,
    }
}
