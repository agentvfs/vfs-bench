/**
 * Every service with a port, loaded for its router to register (`register`
 * in world.ts): each `app_<service>.ts` in this directory, which is also how
 * harbor/automationbench.py's `PORTED` knows them.
 */
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

for (const file of readdirSync(HERE).filter((f) => /^app_[a-z0-9_]+\.ts$/.test(f)).sort()) {
  await import(pathToFileURL(join(HERE, file)).href)
}
