/** `generate_buffer_id(prefix)` (schema/buffer.py): 24 of `[A-Z0-9]`, after `<prefix>_`. */
import { ASCII_UPPERCASE, DIGITS } from './pyrandom.ts'
import type { World } from './world.ts'

export function bufferId(w: World, prefix = ''): string {
  const suffix = w.random.choices(ASCII_UPPERCASE + DIGITS, 24).join('')
  return prefix ? `${prefix}_${suffix}` : suffix
}
