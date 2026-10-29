/**
 * Python's `difflib.SequenceMatcher` (CPython 3.12's Lib/difflib.py), as
 * gaia2-cli's apps use it on strings: `SequenceMatcher(None, a, b).ratio()`.
 *
 * A Python string is a sequence of code points, so `a` and `b` are split
 * into code points (not UTF-16 units) and lengths count code points. With
 * no `isjunk` there is no junk; `autojunk` (on by default) drops from `b`'s
 * index every element that occurs more than `len(b) // 100 + 1` times when
 * `len(b) >= 200`, as Python's does.
 */

interface Match {
  a: number
  b: number
  size: number
}

export class SequenceMatcher {
  private readonly a: string[]
  private readonly b: string[]
  private readonly b2j = new Map<string, number[]>()
  private blocks: Match[] | null = null

  /** `SequenceMatcher(None, a, b, autojunk)`. */
  constructor(a: string | string[], b: string | string[], autojunk = true) {
    this.a = typeof a === 'string' ? Array.from(a) : a
    this.b = typeof b === 'string' ? Array.from(b) : b
    // __chain_b
    this.b.forEach((elt, i) => {
      const indices = this.b2j.get(elt)
      if (indices === undefined) this.b2j.set(elt, [i])
      else indices.push(i)
    })
    const n = this.b.length
    if (autojunk && n >= 200) {
      const ntest = Math.floor(n / 100) + 1
      const popular = [...this.b2j].filter(([, idxs]) => idxs.length > ntest).map(([elt]) => elt)
      for (const elt of popular) this.b2j.delete(elt)
    }
  }

  /** `find_longest_match(alo, ahi, blo, bhi)` (no junk, so only its first extension loop can apply). */
  findLongestMatch(alo: number, ahi: number, blo: number, bhi: number): Match {
    const { a, b, b2j } = this
    let besti = alo
    let bestj = blo
    let bestsize = 0
    let j2len = new Map<number, number>()
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map<number, number>()
      for (const j of b2j.get(a[i]!) ?? []) {
        if (j < blo) continue
        if (j >= bhi) break
        const k = (j2len.get(j - 1) ?? 0) + 1
        newj2len.set(j, k)
        if (k > bestsize) {
          besti = i - k + 1
          bestj = j - k + 1
          bestsize = k
        }
      }
      j2len = newj2len
    }
    // Popular elements are not in b2j but are not junk: extend over them.
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti -= 1
      bestj -= 1
      bestsize += 1
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize += 1
    return { a: besti, b: bestj, size: bestsize }
  }

  /** `get_matching_blocks()`. */
  getMatchingBlocks(): Match[] {
    if (this.blocks !== null) return this.blocks
    const la = this.a.length
    const lb = this.b.length
    const queue: [number, number, number, number][] = [[0, la, 0, lb]]
    const found: Match[] = []
    while (queue.length > 0) {
      const [alo, ahi, blo, bhi] = queue.pop()!
      const x = this.findLongestMatch(alo, ahi, blo, bhi)
      const { a: i, b: j, size: k } = x
      if (k) {
        found.push(x)
        if (alo < i && blo < j) queue.push([alo, i, blo, j])
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi])
      }
    }
    found.sort((x, y) => x.a - y.a || x.b - y.b || x.size - y.size)
    let i1 = 0
    let j1 = 0
    let k1 = 0
    const nonAdjacent: Match[] = []
    for (const { a: i2, b: j2, size: k2 } of found) {
      if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2
      else {
        if (k1) nonAdjacent.push({ a: i1, b: j1, size: k1 })
        i1 = i2
        j1 = j2
        k1 = k2
      }
    }
    if (k1) nonAdjacent.push({ a: i1, b: j1, size: k1 })
    nonAdjacent.push({ a: la, b: lb, size: 0 })
    this.blocks = nonAdjacent
    return nonAdjacent
  }

  /** `ratio()`: `2.0 * matches / (len(a) + len(b))`, or 1.0 for two empty sequences. */
  ratio(): number {
    const matches = this.getMatchingBlocks().reduce((sum, m) => sum + m.size, 0)
    const length = this.a.length + this.b.length
    return length ? (2.0 * matches) / length : 1.0
  }
}
