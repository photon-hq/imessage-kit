/**
 * iMessage transport service identification.
 *
 * Known service strings from chat.db:
 *   - "iMessage"
 *   - "SMS"
 *   - "RCS"
 */

// -----------------------------------------------
// Types
// -----------------------------------------------

/** Transport protocol used by a conversation or message. */
export type Service = 'iMessage' | 'SMS' | 'RCS' | 'unknown'

// -----------------------------------------------
// Resolution
// -----------------------------------------------

const SERVICE_MAP: Readonly<Record<string, Service>> = {
    imessage: 'iMessage',
    sms: 'SMS',
    rcs: 'RCS',
}

/** Resolve a raw service string to a typed Service value. Case-insensitive exact match. */
export function resolveService(raw: string | null): Service {
    if (raw == null) return 'unknown'

    return SERVICE_MAP[raw.toLowerCase()] ?? 'unknown'
}
