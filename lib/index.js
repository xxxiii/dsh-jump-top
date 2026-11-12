/**
 * dsh-jump-top — server half.
 *
 * This plugin only contributes a browser entry. The Host still needs a
 * loadable entry point for the bundle, so this module is a deliberate no-op:
 * its whole job is to make the bundle patch valid and to let the profile
 * enable the package without pulling any Node-side service in.
 */

export const name = 'dsh-jump-top'
export const version = '0.1.0'
export const inject = []

export function apply() {
  // Intentionally empty: the browser half is served from ./lib/client.js.
}
