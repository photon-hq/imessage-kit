import type { SheetsClient } from '../db/sheets'
import type { User } from '../db/users'
import type { VenueMenu } from '../scraper/types'
import { buildSystemPrompt } from './prompts/system'
import { executeTool, type ToolArgs } from './tools'

export interface AgentFunctionCall {
    name: string
    args: ToolArgs
}

export interface AgentStepResponse {
    text: string
    functionCalls: AgentFunctionCall[]
}

export interface HistoryTurn {
    role: 'user' | 'model' | 'tool'
    content: string
    toolName?: string
    functionCalls?: AgentFunctionCall[]
}

export interface AgentStepContext {
    systemPrompt: string
    history: HistoryTurn[]
}

export interface AgentGeminiClient {
    step(ctx: AgentStepContext): Promise<AgentStepResponse>
}

export type FetchMenu = (venueId: string, date: string) => Promise<VenueMenu>

export interface RunAgentInput {
    client: SheetsClient
    user: User | null
    text: string
    geminiClient: AgentGeminiClient
    fetchMenu?: FetchMenu
    priorHistory?: HistoryTurn[]
}

const MAX_ITERS = 6

export async function runAgent(input: RunAgentInput): Promise<string> {
    const { client, user, text, geminiClient, fetchMenu, priorHistory } = input
    const preferredVenues = (user?.stateContext?.preferredVenues as string[] | undefined) ?? []
    const systemPrompt = buildSystemPrompt({
        now: new Date(),
        user: user
            ? {
                  name: user.name,
                  dietaryRestrictions: user.dietaryRestrictions,
                  preferredVenues,
              }
            : undefined,
    })
    const history: HistoryTurn[] = [
        ...(priorHistory ?? []),
        { role: 'user', content: text },
    ]

    for (let i = 0; i < MAX_ITERS; i++) {
        const response = await geminiClient.step({ systemPrompt, history })
        if (response.functionCalls.length === 0) {
            return response.text.trim() || "I'm not sure — try asking about a specific hall?"
        }
        history.push({
            role: 'model',
            content: response.text,
            functionCalls: response.functionCalls,
        })
        for (const call of response.functionCalls) {
            const result = await executeTool(call.name, call.args, { client, user, fetchMenu })
            // Log tool name + result preview only — args may contain user-provided text we
            // don't want in production logs.
            if (process.env.NODE_ENV !== 'production') {
                const preview = result.replace(/\s+/g, ' ').slice(0, 120)
                console.log(`[agent] tool=${call.name} -> ${preview}`)
            }
            history.push({ role: 'tool', content: result, toolName: call.name })
        }
    }

    return "I'm having trouble answering that right now — try rephrasing?"
}
