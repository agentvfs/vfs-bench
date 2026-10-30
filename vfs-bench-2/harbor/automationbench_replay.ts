/** Offline transport: a fresh isolated verifier workspace for every case. */
import { createInterface } from 'node:readline'
import { verifyAutomation } from './verify-automationbench.ts'
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  try {
    console.log(JSON.stringify({ result: await verifyAutomation(JSON.parse(line)) }))
  } catch (error) {
    console.log(JSON.stringify({ error: String(error) }))
  }
}
