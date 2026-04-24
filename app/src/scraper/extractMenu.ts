import { GoogleGenAI, Type } from '@google/genai'
import type { Daypart, VenueMenu } from './types'

export interface ExtractHints {
    venueId: string
    venueName: string
    date: string
}

export interface GeminiClient {
    extract(blob: string, hints: ExtractHints): Promise<{ dayparts: Daypart[] }>
}

const DAYPART_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        dayparts: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    label: { type: Type.STRING },
                    startIso: { type: Type.STRING },
                    endIso: { type: Type.STRING },
                    stations: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                name: { type: Type.STRING },
                                items: {
                                    type: Type.ARRAY,
                                    items: {
                                        type: Type.OBJECT,
                                        properties: {
                                            name: { type: Type.STRING },
                                            description: { type: Type.STRING },
                                            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                                        },
                                        required: ['name', 'tags'],
                                    },
                                },
                            },
                            required: ['name', 'items'],
                        },
                    },
                },
                required: ['label', 'startIso', 'endIso', 'stations'],
            },
        },
    },
    required: ['dayparts'],
}

function buildPrompt(hints: ExtractHints, blob: string): string {
    return `You are extracting a Penn dining menu from a Bon Appétit Bamco JS blob.

Venue: ${hints.venueName} (id: ${hints.venueId})
Date: ${hints.date} (America/New_York)

Parse the blob below into a VenueMenu. Rules:
- \`label\` must be normalized to one of: "Breakfast", "Brunch", "Lunch", "Dinner", "Late Night", "Snack", or the closest match if none fit.
- \`startIso\`/\`endIso\` must be UTC ISO 8601 strings converted from the NY-local times in the blob.
- \`tags\` come from the Bamco \`cor_icon\` / dietary markers; normalize to lowercase short labels like "vegan", "vegetarian", "halal", "kosher", "gluten-free", "made-without-gluten", "jain". Omit unknown tags.
- Preserve station order as they appear in the blob.
- Skip empty stations.

Bamco blob:
\`\`\`
${blob}
\`\`\``
}

export function createGeminiClient(apiKey: string, model = 'gemini-2.5-flash'): GeminiClient {
    const ai = new GoogleGenAI({ apiKey })
    return {
        async extract(blob, hints) {
            const response = await ai.models.generateContent({
                model,
                contents: [{ role: 'user', parts: [{ text: buildPrompt(hints, blob) }] }],
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: DAYPART_SCHEMA,
                    maxOutputTokens: 4096,
                },
            })
            const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
            const parsed = JSON.parse(text) as { dayparts: Daypart[] }
            return parsed
        },
    }
}

export interface ExtractOptions extends ExtractHints {
    client: GeminiClient
}

export async function extractMenu(blob: string, opts: ExtractOptions): Promise<VenueMenu> {
    const { venueId, venueName, date, client } = opts
    const { dayparts } = await client.extract(blob, { venueId, venueName, date })
    return {
        venueId,
        venueName,
        date,
        dayparts,
        fetchedAt: new Date().toISOString(),
    }
}
