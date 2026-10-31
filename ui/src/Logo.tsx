/**
 * The AgentVFS brand as agentvfs.org's header draws it (website
 * src/components/ui.tsx `Mark`, globals.css `.brand`): the wireframe cube,
 * stroked in `currentColor`, beside the wordmark.
 */
export function Brand() {
  return (
    <span className="brand" aria-label="AgentVFS">
      <svg width="24" height="26" viewBox="0 0 32 34" fill="none" aria-hidden="true">
        <path
          d="M16 2 30 10v15l-14 8L2 25V10L16 2Z M2 10l14 8 14-8 M16 2v31"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      AgentVFS
    </span>
  )
}
