import { GoogleGenAI, Type } from '@google/genai'
import type { MealEvent } from '../db/mealEvents'
import type { ExtractedTidbit } from './flows/followup'

export interface TidbitGeminiClient {
    extract(reply: string, event: MealEvent): Promise<ExtractedTidbit[]>
}

const SCHEMA = {
    type: Type.OBJECT,
    properties: {
        tidbits: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    item: { type: Type.STRING },
                    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ['item', 'tags'],
            },
        },
    },
    required: ['tidbits'],
}

export function createTidbitClient(apiKey: string, model = 'gemini-2.5-flash'): TidbitGeminiClient {
    const ai = new GoogleGenAI({ apiKey })
    return {
        async extract(reply, event) {
            const prompt = `A Penn student just replied to a post-meal check-in. Extract 0..N short shareable "tidbits" — things other students would find useful about this meal today.

Meal: ${event.mealLabel} at ${event.venueId} on ${event.date}
Reply: "${reply}"

Rules:
- Each tidbit must be under 60 chars, paraphrased not verbatim.
- Tags must include exactly one of "positive", "negative", "neutral".
- Optional additional tags: a short food/station keyword (e.g. "pasta", "salad").
- Skip anything personal or identifying (names, locations outside the venue).
- If the reply has no shareable food info, return an empty array.`

            const response = await ai.models.generateContent({
                model,
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: SCHEMA,
                    maxOutputTokens: 512,
                },
            })
            const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '{"tidbits":[]}'
            const parsed = JSON.parse(text) as { tidbits: ExtractedTidbit[] }
            return parsed.tidbits
        },
    }
}

export async function extractTidbits(
    reply: string,
    event: MealEvent,
    client: TidbitGeminiClient,
): Promise<ExtractedTidbit[]> {
    const raw = await client.extract(reply, event)
    return raw.filter((t) => t.item.trim().length > 0)
}
