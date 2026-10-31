/**
 * gaia2-cli's `chats` app (apps/chats.py): the messaging program of
 * `../gaia2_messages/app.ts`, whose default titles name a participant
 * with no name by their raw id (phone-number mode's number).
 */
import { messagingCommands } from '../gaia2_messages/app.ts'

export const APP_NAME = 'Chats'

/** The `chats` app's commands. */
export const commands = messagingCommands(APP_NAME, true)
