/**
 * Configuration for the Penn Dining iMessage Agent.
 *
 * pennDiningId — the `id` field from GET /api/dining/venues/ responses.
 * bonAppetitId — Bamco.current_cafe.id embedded in the Bon Appétit HTML page
 *                (https://university-of-pennsylvania.cafebonappetit.com/cafe/{slug}/).
 */

export type VenueType = 'residential' | 'retail' | 'cafe'

export interface VenueConfig {
    /** Display name */
    name: string
    /** Penn Dining API venue `id` — used to match API responses */
    pennDiningId: number
    /** Bon Appétit URL slug — used to scrape menus */
    bonAppetitSlug: string | null
    /** Bon Appétit numeric cafe ID (Bamco.current_cafe.id) */
    bonAppetitId: number | null
    /** Address */
    address: string
    /** Venue type */
    type: VenueType
    /** Tags for agent context */
    tags: string[]
}

export const VENUES: VenueConfig[] = [
    // ── Residential (all-you-care-to-eat) ──────────────────────────────────
    {
        name: '1920 Commons',
        pennDiningId: 593,
        bonAppetitSlug: '1920-commons',
        bonAppetitId: 243,
        address: '3800 Locust Walk',
        type: 'residential',
        tags: ['all-you-care-to-eat', 'salad bar', 'pizza', 'grill', 'vegan', 'vegetarian'],
    },
    {
        name: 'Hill House',
        pennDiningId: 636,
        bonAppetitSlug: 'hill-house',
        bonAppetitId: 244,
        address: '3333 Walnut St.',
        type: 'residential',
        tags: ['all-you-care-to-eat', 'food hall', 'jain', 'weekend brunch'],
    },
    {
        name: 'English House',
        pennDiningId: 637,
        bonAppetitSlug: 'kings-court-english-house',
        bonAppetitId: 245,
        address: '3465 Sansom St.',
        type: 'residential',
        tags: ['all-you-care-to-eat', 'halal', 'smoothies', 'expo'],
    },
    {
        name: 'Falk Kosher Dining',
        pennDiningId: 638,
        bonAppetitSlug: 'falk-dining-commons',
        bonAppetitId: 246,
        address: '215 S. 39th Street',
        type: 'residential',
        tags: ['all-you-care-to-eat', 'kosher', 'glatt kosher', 'shabbat'],
    },
    {
        name: 'Lauder College House',
        pennDiningId: 1442,
        bonAppetitSlug: 'lauder-college-house',
        bonAppetitId: 9839,
        address: '3335 Woodland Walk',
        type: 'residential',
        tags: ['all-you-care-to-eat', 'featured entree', 'dinner only'],
    },
    {
        name: 'Quaker Kitchen',
        pennDiningId: 1464004,
        bonAppetitSlug: 'quaker-kitchen',
        bonAppetitId: null,
        address: '201 S 40th St',
        type: 'residential',
        tags: ['one swipe', 'culinary sessions', 'chef-led', 'reservation'],
    },
    {
        name: 'Cafe West',
        pennDiningId: 1464009,
        bonAppetitSlug: null,
        bonAppetitId: null,
        address: '201 S 40th St',
        type: 'residential',
        tags: ['meal exchange', 'cafe', 'Gutmann'],
    },

    // ── Retail ─────────────────────────────────────────────────────────────
    {
        name: 'Houston Market',
        pennDiningId: 639,
        bonAppetitSlug: 'houston-market',
        bonAppetitId: 247,
        address: '3417 Spruce St.',
        type: 'retail',
        tags: ['meal exchange', 'market', 'bento'],
    },
    {
        name: 'Accenture Café',
        pennDiningId: 641,
        bonAppetitSlug: 'accenture-cafe',
        bonAppetitId: 249,
        address: '220 S. 33rd St.',
        type: 'retail',
        tags: ['meal exchange'],
    },
    {
        name: "Joe's Café",
        pennDiningId: 642,
        bonAppetitSlug: 'joes-cafe',
        bonAppetitId: 250,
        address: '3620 Locust Walk',
        type: 'cafe',
        tags: ['meal exchange', 'coffee'],
    },
    {
        name: 'McClelland Express',
        pennDiningId: 747,
        bonAppetitSlug: null,
        bonAppetitId: null,
        address: '3700 Spruce St.',
        type: 'retail',
        tags: ['sushi', 'market'],
    },
    {
        name: '1920 Gourmet Grocer',
        pennDiningId: 1057,
        bonAppetitSlug: '1920-gourmet-grocer',
        bonAppetitId: 1128,
        address: '3800 Locust Walk',
        type: 'retail',
        tags: ['meal exchange', 'market', 'late night'],
    },
    {
        name: '1920 Starbucks',
        pennDiningId: 1163,
        bonAppetitSlug: '1920-starbucks',
        bonAppetitId: 9147,
        address: '3800 Locust Walk',
        type: 'cafe',
        tags: ['coffee', 'late night'],
    },
    {
        name: 'Pret a Manger MBA',
        pennDiningId: 1732,
        bonAppetitSlug: 'pret-a-manger-upper',
        bonAppetitId: 10902,
        address: 'Huntsman Hall',
        type: 'cafe',
        tags: ['sandwiches', 'coffee'],
    },
    {
        name: 'Pret a Manger Locust Walk',
        pennDiningId: 1733,
        bonAppetitSlug: 'pret-a-manger-lower',
        bonAppetitId: 10903,
        address: 'Locust Walk',
        type: 'cafe',
        tags: ['sandwiches', 'coffee'],
    },
]

/** Index by Penn Dining API id — O(1) lookup when processing API responses */
export const VENUES_BY_PENN_ID = new Map<number, VenueConfig>(
    VENUES.map((v) => [v.pennDiningId, v])
)

/**
 * Fuzzy-match a venue by display name. Used when the LLM passes a venue name
 * as a tool argument and we need to find the config.
 */
export function findVenue(name: string): VenueConfig | undefined {
    const lower = name.toLowerCase().trim()
    // Exact match first
    const exact = VENUES.find((v) => v.name.toLowerCase() === lower)
    if (exact) return exact
    // Partial match
    return VENUES.find(
        (v) => v.name.toLowerCase().includes(lower) || lower.includes(v.name.toLowerCase().split(' ')[0]!)
    )
}

// ── Constants ──────────────────────────────────────────────────────────────

/** Penn Dining API base URL */
export const PENN_DINING_API = 'https://dining.business-services.upenn.edu/api/dining/venues/'

/** Bon Appétit base URL */
export const BON_APP_BASE = 'https://university-of-pennsylvania.cafebonappetit.com/cafe'

/** Google Sheets config — set via environment variables */
export const SHEETS_CONFIG = {
    spreadsheetId: process.env.GOOGLE_SHEET_ID ?? '',
    reviewsSheet: 'reviews',
    followupsSheet: 'pending_followups',
    stateSheet: 'conversation_state',
}

/** LLM config */
export const LLM_CONFIG = {
    model: 'gemini-2.5-flash',
    maxOutputTokens: 1024,
}

/** Follow-up delay after meal ends (milliseconds) */
export const FOLLOWUP_DELAY_MS = 15 * 60 * 1000

/** How many reviews to pass to LLM per venue */
export const MAX_REVIEWS_PER_VENUE = 5
