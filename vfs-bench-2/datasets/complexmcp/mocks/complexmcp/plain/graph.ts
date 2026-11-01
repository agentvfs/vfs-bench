/**
 * GraphServer (`servers/graphs/app.py`): traversals, shortest paths,
 * components, a topological sort, Kruskal's tree, matrices and a random
 * graph, statement for statement over the JSON a model sends: an
 * adjacency dict's keys are strs, its values anything Python iterates (a
 * str's characters too), and nodes compare as Python's do (1, 1.0 and True
 * are one key; "1" is another; a list cannot be one). Dijkstra's heap is
 * `heapq`'s and Kruskal's sort `list.sort`'s, so a comparison of a str with
 * an int fails where theirs does.
 *
 * `path_exists`, `adjacency_list_to_matrix` and a non-empty `is_connected`
 * call `bfs.__wrapped__`, which a FunctionTool lacks, so they always fail,
 * as upstream's do. `graph_complement` lists Python sets: CPython's order
 * for numbers (`PySet`), but strs hash per process upstream.
 * `random_erdos_renyi` draws from node's generator.
 */
import { PyError } from '../common.ts'
import { PyDict, PyFloat, PySet, pyAdd, pyEq, pyIter, pyKey, pyLen, pyLt, repr, unpack } from '../../../../../workspace/py.ts'
import { plainTools } from '../tool.ts'

type Adj = Record<string, unknown>

/** `adj.get(key, [])`: only a str can be one of a JSON dict's keys. */
function get(adj: Adj, key: unknown): unknown {
  pyKey(key)
  return typeof key === 'string' && Object.hasOwn(adj, key) ? adj[key] : []
}

/** A set's membership, as `in` and `.add` check it (an unhashable value fails as a set element). */
class Seen {
  private readonly keys = new Set<string>()
  has(v: unknown): boolean {
    return this.keys.has(pyKey(v, 'set element'))
  }
  add(v: unknown): void {
    this.keys.add(pyKey(v, 'set element'))
  }
}

/** `float('inf')`, `dist.get`'s default. */
const INF = new PyFloat(Infinity)

/** `heapq.heappush`. */
function heappush(heap: unknown[], item: unknown): void {
  heap.push(item)
  siftdown(heap, 0, heap.length - 1)
}

/** `heapq.heappop`. */
function heappop(heap: unknown[]): unknown {
  const last = heap.pop()
  if (heap.length === 0) return last
  const out = heap[0]
  heap[0] = last
  siftup(heap, 0)
  return out
}

function siftdown(heap: unknown[], start: number, pos: number): void {
  const item = heap[pos]
  while (pos > start) {
    const parentPos = (pos - 1) >> 1
    const parent = heap[parentPos]
    if (pyLt(item, parent)) {
      heap[pos] = parent
      pos = parentPos
      continue
    }
    break
  }
  heap[pos] = item
}

function siftup(heap: unknown[], pos: number): void {
  const end = heap.length
  const start = pos
  const item = heap[pos]
  let child = 2 * pos + 1
  while (child < end) {
    const right = child + 1
    if (right < end && !pyLt(heap[child], heap[right])) child = right
    heap[pos] = heap[child]
    pos = child
    child = 2 * pos + 1
  }
  heap[pos] = item
  siftdown(heap, start, pos)
}

/**
 * `sorted(xs)`: CPython's `list.sort` for up to 64 items (a run counted
 * with `count_run`, then binary insertion), so its comparisons, and the
 * one that fails, are its; a longer list is merge-sorted.
 */
function sortedPy(xs: readonly unknown[]): unknown[] {
  const a = [...xs]
  const n = a.length
  if (n < 2) return a
  if (n > 64) return mergeSort(a)
  const reverse = (lo: number, hi: number) => {
    for (hi--; lo < hi; lo++, hi--) [a[lo], a[hi]] = [a[hi], a[lo]]
  }
  // count_run
  let run = 1
  for (; run < n; run++) if (pyLt(a[run], a[run - 1])) break
  if (run < n) {
    let ascending = false
    if (run > 1) {
      if (pyLt(a[0], a[run - 1])) ascending = true
      else reverse(0, run)
    }
    if (!ascending) {
      run++
      let neq = 0
      const reverseLastNeq = () => {
        if (neq) {
          neq++
          reverse(run - neq, run)
          neq = 0
        }
      }
      for (; run < n; run++) {
        if (pyLt(a[run], a[run - 1])) reverseLastNeq()
        else if (pyLt(a[run - 1], a[run])) break
        else neq++
      }
      reverseLastNeq()
      reverse(0, run)
      for (; run < n; run++) if (pyLt(a[run], a[run - 1])) break
    }
  }
  // binarysort
  for (let ok = run; ok < n; ok++) {
    const pivot = a[ok]
    let lo = 0
    let hi = ok
    do {
      const mid = (lo + hi) >> 1
      if (pyLt(pivot, a[mid])) hi = mid
      else lo = mid + 1
    } while (lo < hi)
    for (let m = ok; m > lo; m--) a[m] = a[m - 1]
    a[lo] = pivot
  }
  return a
}

function mergeSort(a: unknown[]): unknown[] {
  if (a.length < 2) return a
  const mid = a.length >> 1
  const left = mergeSort(a.slice(0, mid))
  const right = mergeSort(a.slice(mid))
  const out: unknown[] = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) out.push(pyLt(right[j], left[i]) ? right[j++] : left[i++])
  return [...out, ...left.slice(i), ...right.slice(j)]
}

function bfs(adj: Adj, start: unknown): unknown[] {
  const visited = new Seen()
  const order: unknown[] = []
  const q = [start]
  visited.add(start)
  while (q.length) {
    const v = q.shift()
    order.push(v)
    for (const nb of pyIter(get(adj, v))) {
      if (!visited.has(nb)) {
        visited.add(nb)
        q.push(nb)
      }
    }
  }
  return order
}

const wrapped = () => {
  throw new PyError("'FunctionTool' object has no attribute '__wrapped__'")
}

/** `dict[key]`, or the KeyError (its str the key's repr). */
function item<V>(d: PyDict<V>, key: unknown): V {
  if (!d.has(key)) throw new PyError(repr(key))
  return d.get(key)!
}


export const tools = plainTools({
  bfs: [
    [
      ['adj', 'dict'],
      ['start', 'Any'],
    ],
    'list',
    ({ adj, start }) => bfs(adj, start),
  ],
  dfs: [
    [
      ['adj', 'dict'],
      ['start', 'Any'],
    ],
    'list',
    ({ adj, start }) => {
      const visited = new Seen()
      const order: unknown[] = []
      const stack = [start]
      while (stack.length) {
        const v = stack.pop()
        if (visited.has(v)) continue
        visited.add(v)
        order.push(v)
        for (const nb of pyIter(get(adj, v))) if (!visited.has(nb)) stack.push(nb)
      }
      return order
    },
  ],
  shortest_path_dijkstra: [
    [
      ['adj', 'dict'],
      ['source', 'Any'],
    ],
    'dict',
    ({ adj, source }) => {
      const dist = PyDict.from<unknown>([[source, 0]])
      const pq: unknown[] = [[0, source]]
      while (pq.length) {
        const [d, u] = heappop(pq) as [unknown, unknown]
        if (!pyEq(d, dist.has(u) ? dist.get(u) : INF)) continue
        for (const edge of pyIter(get(adj, u))) {
          const [v, w] = unpack(edge, 2)
          const nd = pyAdd(d, w)
          if (pyLt(nd, dist.has(v) ? dist.get(v) : INF)) {
            dist.set(v, nd)
            heappush(pq, [nd, v])
          }
        }
      }
      return dist
    },
  ],
  is_bipartite: [
    [['adj', 'dict']],
    'boolean',
    ({ adj }) => {
      const color = new PyDict<number>()
      for (const start of Object.keys(adj)) {
        if (color.has(start)) continue
        const queue: unknown[] = [start]
        color.set(start, 0)
        while (queue.length) {
          const u = queue.shift()
          for (const v of pyIter(get(adj, u))) {
            if (color.has(v)) {
              if (color.get(v) === color.get(u)) return false
            } else {
              color.set(v, 1 - color.get(u)!)
              queue.push(v)
            }
          }
        }
      }
      return true
    },
  ],
  connected_components: [
    [['adj', 'dict']],
    'list[list]',
    ({ adj }) => {
      const seen = new Seen()
      const comps: unknown[][] = []
      for (const n of Object.keys(adj)) {
        if (seen.has(n)) continue
        const comp: unknown[] = []
        const q: unknown[] = [n]
        seen.add(n)
        while (q.length) {
          const u = q.shift()
          comp.push(u)
          for (const v of pyIter(get(adj, u))) {
            if (!seen.has(v)) {
              seen.add(v)
              q.push(v)
            }
          }
        }
        comps.push(comp)
      }
      return comps
    },
  ],
  topological_sort: [
    [['adj', 'dict']],
    'list',
    ({ adj }) => {
      const indeg = new PyDict<number>()
      for (const u of Object.keys(adj)) {
        for (const v of pyIter(adj[u])) indeg.set(v, (indeg.get(v) ?? 0) + 1)
        if (!indeg.has(u)) indeg.set(u, 0)
      }
      const q = indeg.entries().filter(([, d]) => d === 0).map(([n]) => n)
      const res: unknown[] = []
      while (q.length) {
        const u = q.shift()
        res.push(u)
        for (const v of pyIter(get(adj, u))) {
          indeg.set(v, (indeg.get(v) ?? 0) - 1)
          if (indeg.get(v) === 0) q.push(v)
        }
      }
      if (res.length !== indeg.size) throw new PyError('graph has cycles')
      return res
    },
  ],
  mst_kruskal: [
    [
      ['edges', 'list'],
      ['nodes', 'list'],
    ],
    'list',
    ({ edges, nodes }) => {
      const parent = PyDict.from<unknown>((nodes as unknown[]).map((n) => [n, n]))
      const find = (x: unknown): unknown => {
        while (!pyEq(item(parent, x), x)) {
          parent.set(x, item(parent, item(parent, x)))
          x = item(parent, x)
        }
        return x
      }
      const union = (a: unknown, b: unknown) => {
        const ra = find(a)
        const rb = find(b)
        parent.set(ra, rb)
      }
      const res: unknown[] = []
      for (const edge of sortedPy(edges)) {
        const [w, u, v] = unpack(edge, 3)
        if (!pyEq(find(u), find(v))) {
          union(u, v)
          res.push([w, u, v])
        }
      }
      return res
    },
  ],
  shortest_path_unweighted: [
    [
      ['adj', 'dict'],
      ['source', 'Any'],
    ],
    'dict',
    ({ adj, source }) => {
      const dist = PyDict.from<unknown>([[source, 0]])
      const q = [source]
      while (q.length) {
        const u = q.shift()
        for (const v of pyIter(get(adj, u))) {
          if (!dist.has(v)) {
            dist.set(v, pyAdd(dist.get(u), 1))
            q.push(v)
          }
        }
      }
      return dist
    },
  ],
  path_exists: [
    [
      ['adj', 'dict'],
      ['a', 'Any'],
      ['b', 'Any'],
    ],
    'boolean',
    wrapped,
  ],
  adjacency_matrix: [
    [
      ['adj', 'dict'],
      ['nodes', 'list'],
    ],
    'list[list[int]]',
    ({ adj, nodes }) => {
      const idx = PyDict.from<number>((nodes as unknown[]).map((n, i) => [n, i]))
      const n = nodes.length
      const mat = Array.from({ length: n }, () => Array<number>(n).fill(0))
      for (const u of Object.keys(adj)) {
        for (const v of pyIter(adj[u])) if (idx.has(u) && idx.has(v)) mat[idx.get(u)!]![idx.get(v)!] = 1
      }
      return mat
    },
  ],
  adjacency_list_to_matrix: [[['adj', 'dict']], 'list', wrapped],
  degree_centrality: [[['adj', 'dict']], 'dict', ({ adj }) => Object.fromEntries(Object.keys(adj).map((n) => [n, pyLen(get(adj, n))]))],
  is_connected: [
    [['adj', 'dict']],
    'boolean',
    ({ adj }) => {
      if (Object.keys(adj).length === 0) return true
      return wrapped()
    },
  ],
  graph_complement: [
    [
      ['adj', 'dict'],
      ['nodes', 'list'],
    ],
    'dict',
    ({ adj, nodes }) => {
      const comp = PyDict.from<unknown>((nodes as unknown[]).map((n) => [n, []]))
      const s = new PySet(nodes)
      for (const u of nodes as unknown[]) {
        const nbrs = new PySet(pyIter(get(adj, u)))
        const others = s.difference(nbrs).difference(new PySet([u]))
        comp.set(u, [...others])
      }
      return comp
    },
  ],
  random_erdos_renyi: [
    [
      ['n', 'int'],
      ['p', 'float'],
    ],
    'dict',
    ({ n, p }) => {
      const adj = new PyDict<number[]>()
      for (let i = 0; i < n; i++) adj.set(i, [])
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (Math.random() < p.v) {
            adj.get(i)!.push(j)
            adj.get(j)!.push(i)
          }
        }
      }
      return adj
    },
  ],
})
