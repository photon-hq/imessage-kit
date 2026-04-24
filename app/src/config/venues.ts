export type VenueType = 'dining_hall' | 'cafe' | 'market' | 'retail'

export interface Venue {
    id: string
    name: string
    bonAppetitSlug: string
    address: string
    type: VenueType
    tags: string[]
}

export const VENUES: readonly Venue[] = [
    {
        id: '1920-commons',
        name: '1920 Commons',
        bonAppetitSlug: '1920-commons',
        address: '3700 Spruce St',
        type: 'dining_hall',
        tags: ['all-you-care-to-eat', 'central'],
    },
    {
        id: 'hill-house',
        name: 'Hill House',
        bonAppetitSlug: 'hill-house',
        address: '3333 Walnut St',
        type: 'dining_hall',
        tags: ['all-you-care-to-eat', 'north'],
    },
    {
        id: 'english-house',
        name: 'English House',
        bonAppetitSlug: 'kings-court-english-college-house',
        address: '3465 Sansom St',
        type: 'dining_hall',
        tags: ['all-you-care-to-eat', 'west'],
    },
    {
        id: 'falk-kosher',
        name: 'Falk Kosher',
        bonAppetitSlug: 'falk-dining-commons',
        address: '3200 Chestnut St',
        type: 'dining_hall',
        tags: ['kosher'],
    },
    {
        id: 'lauder',
        name: 'Lauder College House',
        bonAppetitSlug: 'lauder-college-house',
        address: '3650 Walnut St',
        type: 'dining_hall',
        tags: ['dinner-only', 'central'],
    },
    {
        id: 'quaker-kitchen',
        name: 'Quaker Kitchen',
        bonAppetitSlug: 'quaker-kitchen',
        address: '3440 Market St',
        type: 'dining_hall',
        tags: ['west'],
    },
    {
        id: 'cafe-west',
        name: 'Cafe West',
        bonAppetitSlug: 'cafe-west',
        address: '3401 Walnut St',
        type: 'cafe',
        tags: ['coffee', 'quick'],
    },
    {
        id: 'houston-market',
        name: 'Houston Market',
        bonAppetitSlug: 'houston-market',
        address: '3417 Spruce St',
        type: 'market',
        tags: ['grab-and-go'],
    },
    {
        id: 'accenture-cafe',
        name: 'Accenture Café',
        bonAppetitSlug: 'accenture-cafe',
        address: '3501 Sansom St',
        type: 'cafe',
        tags: ['coffee'],
    },
    {
        id: 'joes-cafe',
        name: "Joe's Café",
        bonAppetitSlug: 'joes-cafe',
        address: '3330 Walnut St',
        type: 'cafe',
        tags: ['coffee'],
    },
    {
        id: 'mcclelland-express',
        name: 'McClelland Express',
        bonAppetitSlug: 'mcclelland-express',
        address: '3700 Spruce St',
        type: 'market',
        tags: ['grab-and-go'],
    },
    {
        id: '1920-gourmet-grocer',
        name: '1920 Gourmet Grocer',
        bonAppetitSlug: '1920-gourmet-grocer',
        address: '3700 Spruce St',
        type: 'market',
        tags: ['groceries'],
    },
    {
        id: '1920-starbucks',
        name: '1920 Starbucks',
        bonAppetitSlug: '1920-starbucks',
        address: '3700 Spruce St',
        type: 'retail',
        tags: ['coffee'],
    },
    {
        id: 'pret-mba',
        name: 'Pret A Manger MBA',
        bonAppetitSlug: 'pret-a-manger-mba',
        address: '3730 Walnut St',
        type: 'retail',
        tags: ['coffee', 'sandwiches'],
    },
    {
        id: 'pret-locust',
        name: 'Pret A Manger Locust Walk',
        bonAppetitSlug: 'pret-a-manger-locust-walk',
        address: '3744 Spruce St',
        type: 'retail',
        tags: ['coffee', 'sandwiches'],
    },
]

export function findVenue(query: string): Venue | undefined {
    const q = query.toLowerCase().trim()
    if (!q) return undefined
    const exact = VENUES.find((v) => v.name.toLowerCase() === q || v.id === q)
    if (exact) return exact
    return VENUES.find((v) => v.name.toLowerCase().includes(q) || v.id.includes(q))
}

export function getDiningHalls(): Venue[] {
    return VENUES.filter((v) => v.type === 'dining_hall')
}
