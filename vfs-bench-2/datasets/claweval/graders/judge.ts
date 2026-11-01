/** The judge's chat completions transport: the grade's requests, sent. */
import type { Recording } from './judge-client.ts'
import type { Transport } from './grade.ts'

/** Credentials stay here, never in the grade or its recording. */
export function judgeTransport(env: Record<string, string>, send: typeof fetch = fetch): Transport {
  return async (request, signal) => {
    if (!env.OPENAI_API_KEY) throw new Error('Claw-Eval judge requires OPENAI_API_KEY')
    const url = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions'
    const target = new URL(url)
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password)
      throw new Error('Invalid Claw-Eval judge URL')
    try {
      const response = await send(target, {
        method: 'POST',
        redirect: 'error',
        signal: signal ?? AbortSignal.timeout(300_000),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: JSON.stringify(request),
      })
      if (!response.ok) {
        await response.body?.cancel()
        return { error: { message: `Judge HTTP ${response.status}`, status: response.status } }
      }
      // Bound untrusted remote replies before recording or grading them.
      const reader = response.body?.getReader()
      if (!reader) return { error: { message: 'Empty judge response' } }
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.length
          if (size > 4 * 1024 * 1024) throw new Error('Judge response exceeds 4 MiB')
          chunks.push(chunk.value)
        }
      } finally {
        await reader.cancel()
      }
      return { response: JSON.parse(Buffer.concat(chunks).toString('utf8')) } satisfies Omit<Recording, 'request'>
    } catch (error) {
      if (signal?.aborted) throw error
      // Never echo credentials, endpoint query strings, or arbitrary error bodies.
      return { error: { message: 'Judge transport failed' } }
    }
  }
}
