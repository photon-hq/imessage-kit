/**
 * Utility types and helper functions
 */

// ==================== Format validation regex patterns ====================

/**
 * Phone number format regex
 * Supports international format, spaces, hyphens, and parentheses
 * Must contain at least one digit
 */
const PHONE_REGEX = /^\+?[\d\s\-()]+$/

/**
 * Check if string contains at least minimum number of digits
 */
const hasMinDigits = (str: string, min: number): boolean => {
    const digits = str.replace(/\D/g, '')
    return digits.length >= min
}

/**
 * Email format regex
 * Basic email format validation
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * URL format regex
 * Matches URLs starting with http:// or https://
 */
const URL_REGEX = /^https?:\/\/.+/

// ==================== Recipient type ====================

/**
 * Recipient type
 *
 * Can be one of the following formats:
 * - Phone number
 * - Email address
 */
export type Recipient = string

/**
 * Validate recipient format
 *
 * Supported formats:
 * - Phone number: +1234567890, (123) 456-7890
 * - Email address: user@example.com
 *
 * @param value Recipient string (phone or email)
 * @returns Validated recipient
 * @throws TypeError when format is invalid
 */
export const asRecipient = (value: string): Recipient => {
    const normalized = value.trim()

    if (!normalized) {
        throw new TypeError('Recipient cannot be empty')
    }

    // Check email first (more specific)
    if (EMAIL_REGEX.test(normalized)) {
        return normalized
    }

    // Check phone number format and minimum digits
    if (PHONE_REGEX.test(normalized) && hasMinDigits(normalized, 3)) {
        return normalized
    }

    throw new TypeError(`Invalid recipient format: ${value} (phone number or email required)`)
}

/**
 * Check if string is a HTTP(S) URL
 *
 * @param value String to check
 * @returns true if it's a valid URL
 */
export const isURL = (value: string): boolean => {
    return URL_REGEX.test(value)
}

// ==================== Chain API function types ====================

/**
 * Predicate function
 * Returns whether a condition is met
 */
export type Predicate<T> = (value: T) => boolean

/**
 * Async predicate function
 * Returns Promise-wrapped predicate result
 */
export type AsyncPredicate<T> = (value: T) => Promise<boolean>

/**
 * Mapper function
 * Transforms type T to type U
 */
export type Mapper<T, U> = (value: T) => U

/**
 * Handler function
 * Executes operation on data, no return value
 */
export type Handler<T> = (value: T) => void

/**
 * Async handler function
 * Executes async operation, no return value
 */
export type AsyncHandler<T> = (value: T) => Promise<void>
