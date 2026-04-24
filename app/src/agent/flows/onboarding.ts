import { findVenue } from '../../config/venues'
import { addSchedule } from '../../db/schedules'
import type { SheetsClient } from '../../db/sheets'
import { type User, updateUser } from '../../db/users'
import { pickPhrase } from '../prompts/phrases'

export interface OnboardingDeps {
    client: SheetsClient
}

export interface OnboardingResult {
    reply: string
}

const MEAL_LABEL_KEYWORDS: Array<{ label: string; pattern: RegExp; defaultHhmm: string }> = [
    { label: 'Breakfast', pattern: /\bbreakfast\b/i, defaultHhmm: '08:00' },
    { label: 'Brunch', pattern: /\bbrunch\b/i, defaultHhmm: '10:30' },
    { label: 'Lunch', pattern: /\blunch\b/i, defaultHhmm: '12:30' },
    { label: 'Dinner', pattern: /\bdinner\b/i, defaultHhmm: '18:30' },
    { label: 'Late Night', pattern: /\blate.?night\b/i, defaultHhmm: '21:30' },
]

const WEEKDAY_TOKENS: Record<string, number[]> = {
    sunday: [0],
    sun: [0],
    monday: [1],
    mon: [1],
    tuesday: [2],
    tue: [2],
    tues: [2],
    wednesday: [3],
    wed: [3],
    thursday: [4],
    thu: [4],
    thurs: [4],
    friday: [5],
    fri: [5],
    saturday: [6],
    sat: [6],
    weekdays: [1, 2, 3, 4, 5],
    weekends: [0, 6],
    everyday: [0, 1, 2, 3, 4, 5, 6],
    daily: [0, 1, 2, 3, 4, 5, 6],
}

function parseName(raw: string): string | null {
    const trimmed = raw.trim().replace(/\s+/g, ' ')
    if (trimmed.length < 1 || trimmed.length > 60) return null
    if (!/^[\p{L}][\p{L}\s'\-.]*$/u.test(trimmed)) return null
    return trimmed
}

function parseEmail(raw: string): string | null {
    const trimmed = raw.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null
    return trimmed
}

function parseVenueList(raw: string): string[] {
    const lower = raw.trim().toLowerCase()
    if (lower === 'all' || lower === 'any' || lower === 'everything') return ['*']
    const tokens = lower.split(/[,;/]|\s+and\s+/)
    const out: string[] = []
    for (const t of tokens) {
        const v = findVenue(t.trim())
        if (v) out.push(v.id)
    }
    return out
}

interface DaySlot {
    dayOfWeek: number
    mealLabel: string
    hhmm: string
}

function parseDays(raw: string): DaySlot[] {
    const lower = raw.toLowerCase()
    const days = new Set<number>()
    for (const [tok, nums] of Object.entries(WEEKDAY_TOKENS)) {
        if (new RegExp(`\\b${tok}\\b`).test(lower)) {
            for (const n of nums) days.add(n)
        }
    }
    if (days.size === 0) {
        for (const n of WEEKDAY_TOKENS.weekdays!) days.add(n)
    }

    const meals: Array<{ label: string; hhmm: string }> = []
    for (const { label, pattern, defaultHhmm } of MEAL_LABEL_KEYWORDS) {
        if (pattern.test(lower)) {
            const timeMatch = new RegExp(
                `${pattern.source}\\s*(?:at\\s*)?(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?`,
                'i'
            ).exec(lower)
            let hhmm = defaultHhmm
            if (timeMatch) {
                let h = Number(timeMatch[1])
                const m = timeMatch[2] ? Number(timeMatch[2]) : 0
                const ampm = timeMatch[3]?.toLowerCase()
                if (ampm === 'pm' && h < 12) h += 12
                if (ampm === 'am' && h === 12) h = 0
                hhmm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
            }
            meals.push({ label, hhmm })
        }
    }

    if (meals.length === 0) return []

    const slots: DaySlot[] = []
    for (const d of days) {
        for (const m of meals) {
            slots.push({ dayOfWeek: d, mealLabel: m.label, hhmm: m.hhmm })
        }
    }
    return slots
}

function parseDiet(raw: string): string[] {
    const lower = raw.toLowerCase().trim()
    if (['none', 'no', 'nothing', 'n/a', 'na'].includes(lower)) return []
    const canonical: Record<string, string> = {
        vegan: 'vegan',
        vg: 'vegan',
        vegetarian: 'vegetarian',
        veg: 'vegetarian',
        halal: 'halal',
        kosher: 'kosher',
        'gluten-free': 'gluten-free',
        gf: 'gluten-free',
        'gluten free': 'gluten-free',
        'dairy-free': 'dairy-free',
        'dairy free': 'dairy-free',
        nut: 'nut-allergy',
        nuts: 'nut-allergy',
        'nut allergy': 'nut-allergy',
        pescatarian: 'pescatarian',
    }
    const out = new Set<string>()
    for (const tok of lower
        .split(/[,;]|\s+/)
        .map((s) => s.trim())
        .filter(Boolean)) {
        if (canonical[tok]) out.add(canonical[tok]!)
    }
    return [...out]
}

export async function handleOnboardingStep(
    deps: OnboardingDeps,
    user: User,
    message: string
): Promise<OnboardingResult> {
    const { client } = deps

    switch (user.onboardingStep) {
        case '':
        case 'ask_name': {
            if (user.state === 'new') {
                await updateUser(client, user.handle, {
                    state: 'onboarding',
                    onboardingStep: 'ask_name',
                })
                return {
                    reply: `${pickPhrase(user.handle, 'greet')}\n\n${pickPhrase(user.handle, 'ask_name')}`,
                }
            }
            const name = parseName(message)
            if (!name) return { reply: pickPhrase(user.handle, 'ask_name') }
            await updateUser(client, user.handle, { name, onboardingStep: 'ask_email' })
            return { reply: pickPhrase(user.handle, 'ask_email') }
        }
        case 'ask_email': {
            const email = parseEmail(message)
            if (!email) return { reply: pickPhrase(user.handle, 'ask_email') }
            await updateUser(client, user.handle, { email, onboardingStep: 'ask_venues' })
            return { reply: pickPhrase(user.handle, 'ask_venues') }
        }
        case 'ask_venues': {
            const venues = parseVenueList(message)
            if (venues.length === 0) return { reply: pickPhrase(user.handle, 'ask_venues') }
            await updateUser(client, user.handle, {
                stateContext: { ...user.stateContext, preferredVenues: venues },
                onboardingStep: 'ask_days',
            })
            return { reply: pickPhrase(user.handle, 'ask_days') }
        }
        case 'ask_days': {
            const slots = parseDays(message)
            if (slots.length === 0) return { reply: pickPhrase(user.handle, 'ask_days') }
            const preferred = (user.stateContext.preferredVenues as string[] | undefined) ?? ['*']
            const venueForSchedule = preferred.length === 1 && preferred[0] !== '*' ? preferred[0]! : 'auto'
            for (const slot of slots) {
                await addSchedule(client, {
                    handle: user.handle,
                    venueId: venueForSchedule,
                    dayOfWeek: slot.dayOfWeek,
                    mealLabel: slot.mealLabel,
                    startHhmm: slot.hhmm,
                })
            }
            await updateUser(client, user.handle, { onboardingStep: 'ask_diet' })
            return { reply: pickPhrase(user.handle, 'ask_diet') }
        }
        case 'ask_diet': {
            const diet = parseDiet(message)
            await updateUser(client, user.handle, {
                dietaryRestrictions: diet,
                state: 'active',
                onboardingStep: 'done',
            })
            return { reply: pickPhrase(user.handle, 'welcome') }
        }
        default:
            return { reply: '' }
    }
}
