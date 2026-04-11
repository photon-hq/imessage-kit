/**
 * Public configuration re-exports.
 *
 * Compat facade that bundles BOUNDS (runtime config bounds) and
 * LIMITS (send validation limits) for external consumers.
 */

export { SEND_LIMITS as LIMITS } from './domain/validate'
export { BOUNDS } from './sdk-bounds'
