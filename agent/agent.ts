/**
 * Penn Dining Agent — LLM tool-calling loop (Google Gemini).
 *
 * Each incoming iMessage triggers runAgent(), which:
 * 1. Loads conversation state (pending follow-up? awaiting review?)
 * 2. Sends context to Gemini with available tools
 * 3. Executes tool calls in a loop until Gemini produces a final text reply
 * 4. Returns the reply string to the bot
 */

import { GoogleGenAI, Type, type FunctionDeclaration, type Part } from '@google/genai'
import type { MessageScheduler } from '@photon-ai/imessage-kit'
import { LLM_CONFIG } from './config.js'
import { buildSystemPrompt } from './prompts/system.js'
import { checkPendingFollowup, scheduleFollowup } from './tools/followup.js'
import { formatReviewSummary, getReviews, saveReview } from './tools/reviews.js'
import { getConversationState, setConversationState } from './tools/state.js'
import { formatMenu, formatVenueStatus, getVenueMenu, getVenuesToday } from './tools/venues.js'

// ---------------------------------------------------------------------------
// Gemini client (singleton)
// ---------------------------------------------------------------------------

let _ai: GoogleGenAI | null = null
function getAI(): GoogleGenAI {
    if (!_ai) {
        const key = process.env.GEMINI_API_KEY
        if (!key) throw new Error('GEMINI_API_KEY environment variable is not set')
        _ai = new GoogleGenAI({ apiKey: key })
    }
    return _ai
}

// ---------------------------------------------------------------------------
// Tool definitions (Gemini FunctionDeclaration format)
// ---------------------------------------------------------------------------

const TOOL_DECLARATIONS: FunctionDeclaration[] = [
    {
        name: 'get_venues_today',
        description:
            "Fetch all Penn dining venues for today (or a specific date). Returns open/closed status, meal periods, hours, and any special notes. Always call this when asked about what's open or hours.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                date: {
                    type: Type.STRING,
                    description: 'ISO date string YYYY-MM-DD (defaults to today)',
                },
            },
        },
    },
    {
        name: 'get_venue_menu',
        description:
            'Fetch the actual menu items for a specific venue and meal period from Bon Appétit. Returns stations and food items with dietary info.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                venue: {
                    type: Type.STRING,
                    description: 'Venue name, e.g. "Hill House", "1920 Commons"',
                },
                date: {
                    type: Type.STRING,
                    description: 'ISO date string YYYY-MM-DD (defaults to today)',
                },
                meal_period: {
                    type: Type.STRING,
                    description: 'Meal period: "Breakfast", "Lunch", "Dinner", "Brunch", etc.',
                },
            },
            required: ['venue'],
        },
    },
    {
        name: 'get_reviews',
        description:
            'Get community reviews for a venue (and optionally a meal period). Returns avg rating, recent comments, and food highlights sourced from other Penn students.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                venue: {
                    type: Type.STRING,
                    description: 'Venue name (optional — omit to get reviews for all venues)',
                },
                meal_period: {
                    type: Type.STRING,
                    description: 'Filter by meal period (optional)',
                },
                limit: {
                    type: Type.NUMBER,
                    description: 'Max reviews per venue (default 5)',
                },
            },
        },
    },
    {
        name: 'save_review',
        description:
            'Save a community review from this user to the shared database. Call this when you have successfully parsed a rating and comment from the user.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                venue: { type: Type.STRING, description: 'Venue name' },
                meal_period: { type: Type.STRING, description: 'Meal period' },
                date: { type: Type.STRING, description: 'Date visited YYYY-MM-DD' },
                rating: { type: Type.NUMBER, description: 'Rating 1–5' },
                comment: { type: Type.STRING, description: 'User comment (cleaned up but verbatim)' },
                food_highlights: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: 'Specific food items mentioned by the user',
                },
            },
            required: ['venue', 'meal_period', 'date', 'rating', 'comment'],
        },
    },
    {
        name: 'schedule_followup',
        description:
            "Schedule a follow-up iMessage to ask the user how their meal was (~15 min after the meal ends). Call this when the user says they are heading to / going to a dining hall.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                venue: { type: Type.STRING, description: 'Venue name' },
                meal_period: { type: Type.STRING, description: 'Meal period label' },
                meal_end_iso: {
                    type: Type.STRING,
                    description:
                        'ISO datetime when the meal period ends, from the daypart endIso field, e.g. "2026-04-09T21:30:00"',
                },
            },
            required: ['venue', 'meal_period', 'meal_end_iso'],
        },
    },
    {
        name: 'check_pending_followup',
        description:
            "Check if this user has an unanswered follow-up from a previous 'I'm heading to X' message. Returns the venue/meal context, or null. Call this at the start of every message before anything else.",
        parameters: {
            type: Type.OBJECT,
            properties: {},
        },
    },
    {
        name: 'set_conversation_state',
        description:
            "Set the conversation state for this user. Use 'awaiting_review' when you've asked the user for a review and are waiting for their rating. Use 'idle' to reset.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                state: {
                    type: Type.STRING,
                    description: "'idle' or 'awaiting_review'",
                },
                context: {
                    type: Type.OBJECT,
                    description: 'Optional context object, e.g. {venue, meal_period, date}',
                },
            },
            required: ['state'],
        },
    },
]

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

interface ToolArgs {
    date?: string
    venue?: string
    meal_period?: string
    limit?: number
    rating?: number
    comment?: string
    food_highlights?: string[]
    meal_end_iso?: string
    state?: 'idle' | 'awaiting_review'
    context?: Record<string, unknown>
}

async function executeTool(
    name: string,
    args: ToolArgs,
    phone: string,
    scheduler: MessageScheduler
): Promise<string> {
    try {
        switch (name) {
            case 'get_venues_today': {
                const venues = await getVenuesToday(args.date)
                if (venues.length === 0) return 'No venue data available.'
                return venues.map(formatVenueStatus).join('\n\n')
            }

            case 'get_venue_menu': {
                if (!args.venue) return 'Error: venue name required'
                const menu = await getVenueMenu(args.venue, args.date, args.meal_period)
                if (!menu) return `No menu data available for ${args.venue} (no Bon Appétit page or fetch failed).`
                return formatMenu(menu)
            }

            case 'get_reviews': {
                const summaries = await getReviews(args.venue, args.meal_period, args.limit)
                if (summaries.length === 0) return 'No reviews yet — be the first!'
                return summaries.map(formatReviewSummary).join('\n\n')
            }

            case 'save_review': {
                if (!args.venue || !args.meal_period || !args.date || args.rating == null || !args.comment) {
                    return 'Error: missing required fields (venue, meal_period, date, rating, comment)'
                }
                await saveReview({
                    phone,
                    venue: args.venue,
                    mealPeriod: args.meal_period,
                    date: args.date,
                    rating: args.rating,
                    comment: args.comment,
                    foodHighlights: args.food_highlights ?? [],
                })
                return `Review saved: ${args.rating}/5 for ${args.venue} ${args.meal_period}`
            }

            case 'schedule_followup': {
                if (!args.venue || !args.meal_period || !args.meal_end_iso) {
                    return 'Error: venue, meal_period, and meal_end_iso are required'
                }
                const id = await scheduleFollowup({
                    phone,
                    venue: args.venue,
                    mealPeriod: args.meal_period,
                    mealEndIso: args.meal_end_iso,
                    scheduler,
                })
                return `Follow-up scheduled (id: ${id}) for ${args.meal_end_iso}`
            }

            case 'check_pending_followup': {
                const pending = await checkPendingFollowup(phone)
                if (!pending) return 'null'
                return JSON.stringify(pending)
            }

            case 'set_conversation_state': {
                if (!args.state) return 'Error: state required'
                await setConversationState(phone, args.state, args.context ?? {})
                return `State set to ${args.state}`
            }

            default:
                return `Unknown tool: ${name}`
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[Agent] Tool ${name} error:`, msg)
        return `Error: ${msg}`
    }
}

// ---------------------------------------------------------------------------
// Main agent loop
// ---------------------------------------------------------------------------

export interface AgentInput {
    phone: string
    text: string
    scheduler: MessageScheduler
}

/**
 * Run the agent for a single incoming iMessage.
 * Returns the reply string to send back to the user.
 */
export async function runAgent(input: AgentInput): Promise<string> {
    const { phone, text, scheduler } = input
    const ai = getAI()

    // Load conversation state to inject into the system context
    const { state: convState, context: convContext } = await getConversationState(phone)

    let systemInstruction = buildSystemPrompt()
    if (convState === 'awaiting_review') {
        systemInstruction +=
            `\n\n## CURRENT CONTEXT\n` +
            `This user is in state: awaiting_review.\n` +
            `Venue: ${convContext.venue ?? 'unknown'}, meal: ${convContext.mealPeriod ?? 'unknown'}, date: ${convContext.date ?? 'today'}.\n` +
            `Their message is a review response. Infer a 1–5 rating from their sentiment (amazing→5, great→4, decent→3, meh→2, bad→1) and call save_review immediately. ` +
            `Do NOT ask for a number — just infer it. Also call set_conversation_state(idle) to clear state. ` +
            `If their message has no sentiment at all, ask "How was it?" and keep state as awaiting_review.`
    }

    // Gemini multi-turn content history
    const contents: Part[][] = []
    const roles: string[] = []

    // Seed with user's message
    roles.push('user')
    contents.push([{ text }])

    // Track state changes made *during* this turn so the fallback reflects them
    let turnState = convState
    let turnContext = convContext

    let iterCount = 0
    const MAX_ITERS = 6

    while (iterCount < MAX_ITERS) {
        iterCount++

        // Build the contents array in Gemini format
        const geminiContents = contents.map((parts, i) => ({
            role: roles[i]!,
            parts,
        }))

        const response = await ai.models.generateContent({
            model: LLM_CONFIG.model,
            contents: geminiContents,
            config: {
                systemInstruction,
                tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
                maxOutputTokens: LLM_CONFIG.maxOutputTokens,
            },
        })

        const candidate = response.candidates?.[0]
        const responseParts: Part[] = candidate?.content?.parts ?? []

        // Add model's response to history
        roles.push('model')
        contents.push(responseParts)

        // Split into function calls and text
        const functionCallParts = responseParts.filter((p) => p.functionCall)
        const textParts = responseParts.filter((p) => p.text)

        if (functionCallParts.length === 0) {
            // No tool calls — this is the final reply
            const reply = textParts.map((p) => p.text ?? '').join('').trim()
            if (reply) return reply
            // Model returned empty — use the most up-to-date state (may have changed this turn)
            if (turnState === 'awaiting_review') {
                return `How was ${(turnContext as Record<string, string>).venue ?? 'it'}?`
            }
            return "Sorry, I couldn't process that. Try rephrasing?"
        }

        // Execute all function calls (parallelize read-only ones)
        const functionResponses = await Promise.all(
            functionCallParts.map(async (part) => {
                const fc = part.functionCall!
                const args = (fc.args ?? {}) as ToolArgs

                // Mirror set_conversation_state locally so the fallback sees it
                if (fc.name === 'set_conversation_state' && args.state) {
                    turnState = args.state
                    turnContext = (args.context ?? {}) as typeof convContext
                }

                const result = await executeTool(fc.name ?? '', args, phone, scheduler)
                return {
                    functionResponse: {
                        name: fc.name ?? '',
                        response: { result },
                    },
                } satisfies Part
            })
        )

        // Feed results back as a user turn
        roles.push('user')
        contents.push(functionResponses)
    }

    return "Sorry, I ran into an issue fetching that data. Try again in a moment!"
}
