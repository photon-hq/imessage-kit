import { describe, expect, it } from 'bun:test'
import { bootstrap } from '../src/db/bootstrap'
import { createMemoryClient } from '../src/db/sheets'
import { addSchedule, deleteSchedulesFor, listSchedules } from '../src/db/schedules'

async function setup() {
    const client = createMemoryClient({ users: [], schedules: [], meal_events: [], knowledge: [] })
    await bootstrap(client)
    return client
}

describe('schedules repo', () => {
    it('starts empty', async () => {
        const client = await setup()
        expect(await listSchedules(client)).toEqual([])
    })

    it('adds and lists schedules', async () => {
        const client = await setup()
        const s1 = await addSchedule(client, {
            handle: '+14155550123',
            venueId: 'auto',
            dayOfWeek: 1,
            mealLabel: 'Lunch',
            startHhmm: '12:00',
        })
        const s2 = await addSchedule(client, {
            handle: '+14155550123',
            venueId: 'hill-house',
            dayOfWeek: 1,
            mealLabel: 'Dinner',
            startHhmm: '18:30',
        })
        expect(s1.id).not.toBe(s2.id)

        const all = await listSchedules(client)
        expect(all).toHaveLength(2)

        const mine = await listSchedules(client, '+14155550123')
        expect(mine).toHaveLength(2)

        const others = await listSchedules(client, '+14155559999')
        expect(others).toHaveLength(0)
    })

    it('deletes all schedules for a handle', async () => {
        const client = await setup()
        await addSchedule(client, {
            handle: '+14155550123',
            venueId: 'auto',
            dayOfWeek: 1,
            mealLabel: 'Lunch',
            startHhmm: '12:00',
        })
        await addSchedule(client, {
            handle: '+14155559999',
            venueId: 'auto',
            dayOfWeek: 1,
            mealLabel: 'Lunch',
            startHhmm: '12:00',
        })
        await deleteSchedulesFor(client, '+14155550123')
        const remaining = await listSchedules(client)
        expect(remaining).toHaveLength(1)
        expect(remaining[0]?.handle).toBe('+14155559999')
    })
})
