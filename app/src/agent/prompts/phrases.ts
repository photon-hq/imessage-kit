import { createHash } from 'node:crypto'

export const PHRASES = {
    greet: [
        "Hey! I'm PennEats — I help Penn students figure out what to eat on campus. Let's get you set up real quick.",
        "What's up! I'm PennEats. I'll ping you before meals with what's actually good today. Quick setup first?",
        "Hi! PennEats here — dining recs based on real food + real student reviews. Mind answering a few quick qs?",
    ],
    ask_name: [
        'First — what should I call you?',
        'What name do you go by?',
        'What do your friends call you?',
    ],
    ask_email: [
        'Got it. Your Penn email? (so I can tie this to your account)',
        "Cool. What's your Penn email?",
        'And your Penn email address?',
    ],
    ask_venues: [
        "Which dining halls do you usually hit? (you can say 'all' or list a few like '1920, Hill')",
        "Which halls do you actually go to? List the ones you use — or say 'all' if you bounce around.",
        'Which dining halls are in your rotation? Give me a few names or just say "all".',
    ],
    ask_days: [
        'When do you usually eat? E.g. "weekdays lunch + dinner" or "Mon Wed Fri breakfast"',
        'Tell me your usual meal pattern — like "lunch every weekday, dinner Mon-Thu".',
        'What days / meals do you eat on campus? Free-form is fine.',
    ],
    ask_diet: [
        'Any dietary restrictions I should know about? (veg, vegan, kosher, halal, gluten-free, allergies — or "none")',
        'Anything I should avoid recommending? (dietary stuff or allergies — "none" is a valid answer)',
        'Dietary restrictions? Say "none" if none.',
    ],
    welcome: [
        "You're all set. I'll ping you ~20 min before each meal with what's looking good. Feel free to text me anytime for recs too.",
        "Done! I'll hit you up 20 min before your meals with the plan of attack. And ask me anything dining-related whenever.",
        "Perfect. Expect a heads-up before your meals with the good stuff. Ping me anytime for recs.",
    ],
    pre_meal_intro: [
        'Heads up',
        'Quick heads-up',
        'FYI',
    ],
    post_meal_checkin: [
        'How was it?',
        'How did it go?',
        'How was the food?',
    ],
} as const

export type PhraseStep = keyof typeof PHRASES

export function pickPhrase(userId: string, step: PhraseStep): string {
    const pool = PHRASES[step]
    if (!pool) throw new Error(`Unknown phrase step: ${step}`)
    const digest = createHash('sha256').update(`${userId}:${step}`).digest()
    const idx = digest.readUInt32BE(0) % pool.length
    return pool[idx]!
}
