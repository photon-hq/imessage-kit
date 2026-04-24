export interface FoodItem {
    name: string
    description?: string
    tags: string[] // e.g. ['vegan', 'vegetarian', 'halal', 'kosher', 'gluten-free']
}

export interface Station {
    name: string
    items: FoodItem[]
}

export interface Daypart {
    label: string // normalized: Breakfast | Brunch | Lunch | Dinner | Late Night | Snack | ...
    startIso: string
    endIso: string
    stations: Station[]
}

export interface VenueMenu {
    venueId: string
    venueName: string
    date: string // YYYY-MM-DD (NY local)
    dayparts: Daypart[]
    fetchedAt: string // ISO
}
