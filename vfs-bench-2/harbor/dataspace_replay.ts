/** Offline audit transport: each JSON line gets a fresh verifier workspace. */
import { createInterface } from 'node:readline'
import { verifyDataSpace } from './verify-dataspace.ts'
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  try {
    console.log(JSON.stringify({ result: await verifyDataSpace(JSON.parse(line)) }))
  } catch (error) {
    console.log(JSON.stringify({ error: String(error) }))
  }
}
