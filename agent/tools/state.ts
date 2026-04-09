/**
 * Conversation state tools — per-user state machine backed by Google Sheets.
 *
 * States:
 *   idle             — no active conversation
 *   awaiting_review  — bot has asked for a rating; waiting for user's reply
 */

import { getSheetsClient, hashPhone } from '../db/sheets.js'

export type AgentState = 'idle' | 'awaiting_review'

export interface StateContext {
    venue?: string
    mealPeriod?: string
    date?: string
    [key: string]: unknown
}

export interface FullState {
    state: AgentState
    context: StateContext
}

/**
 * Get the current conversation state for a phone number.
 */
export async function getConversationState(phone: string): Promise<FullState> {
    const client = getSheetsClient()
    const phoneHash = hashPhone(phone)
    const row = await client.getState(phoneHash)

    let context: StateContext = {}
    try {
        context = JSON.parse(row.contextJson) as StateContext
    } catch {
        // ignore
    }

    return { state: row.state as AgentState, context }
}

/**
 * Update the conversation state for a phone number.
 */
export async function setConversationState(
    phone: string,
    state: AgentState,
    context: StateContext = {}
): Promise<void> {
    const client = getSheetsClient()
    const phoneHash = hashPhone(phone)
    await client.setState(phoneHash, state, context)
}

/**
 * Reset to idle (convenience).
 */
export async function resetConversationState(phone: string): Promise<void> {
    await setConversationState(phone, 'idle')
}
