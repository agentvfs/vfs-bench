/**
 * OSINTServer (`servers/osint/app.py`): whois, nmap, dnsrecon, dnstwist,
 * dig and host, each a subprocess. Upstream's sandbox image
 * (`src/Dockerfile`, python:3.11-slim) installs none of them, so there
 * each tool answers the FileNotFoundError it catches, under its own
 * prefix; the fake answers those texts and never runs a command or reaches
 * the network. `osint_overview` submits each tool, a FunctionTool, to a
 * thread pool, where calling it fails; upstream joins the failures in the
 * order they complete, this in the list's order.
 */
import { PyError } from '../common.ts'
import { plainTools } from '../tool.ts'

/** What `subprocess.run([binary, ...])` raises in the sandbox: no such binary (or a NUL in an argument first). */
function missing(binary: string, args: string[]): string {
  if (args.some((a) => a.includes('\0'))) return 'embedded null byte'
  return `[Errno 2] No such file or directory: '${binary}'`
}

/** Each tool: its argument's name, its binary and the arguments after it, and how it words a failure. */
const RUNS: [tool: string, param: string, binary: string, prefix: string][] = [
  ['whois_lookup', 'target', 'whois', 'Error during WHOIS lookup: '],
  ['nmap_scan', 'target', 'nmap', 'Error during Nmap scan: '],
  ['dnsrecon_lookup', 'target', 'dnsrecon', 'Error during DNSRecon lookup: '],
  ['dnstwist_lookup', 'domain', 'dnstwist', 'Error running DNSTwist: '],
  ['dig_lookup', 'target', 'dig', 'Error running Dig: '],
  ['host_lookup', 'target', 'host', 'Error running Host lookup: '],
]

export const tools = plainTools({
  ...Object.fromEntries(
    RUNS.map(([tool, param, binary, prefix]) => [tool, [[[param, 'str']], 'string', (args: Record<string, string>) => prefix + missing(binary, [args[param]!])]]),
  ),
  osint_overview: [
    [['target', 'str']],
    'string',
    () => {
      // `future_to_tool = {executor.submit(tool, target): tool.__name__ ...}`:
      // a FunctionTool has no `__name__`, so building the dict fails first.
      throw new PyError("'FunctionTool' object has no attribute '__name__'")
    },
  ],
})
