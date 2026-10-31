import { useEffect, useId, useRef, useState } from 'react'

/**
 * A dropdown drawn in the page's own style: the system's menu sets its own
 * font, corners and shadow, which nothing else here has.
 */
export function Select({
  value,
  options,
  onChange,
  label,
}: {
  value: string
  options: string[]
  onChange: (value: string) => void
  label: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  // Focus stays on the button; aria-activedescendant names the highlighted
  // option, so a screen reader says which one Enter will choose.
  const id = useId()
  const optionId = (i: number) => `${id}-option-${i}`

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const choose = (option: string) => {
    onChange(option)
    setOpen(false)
  }
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return setOpen(false)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) {
        setActive(Math.max(0, options.indexOf(value)))
        return setOpen(true)
      }
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length)
    }
    if (e.key === 'Enter' && open) {
      e.preventDefault()
      choose(options[active])
    }
  }

  return (
    <div className="select" ref={root}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        onClick={() => {
          setActive(Math.max(0, options.indexOf(value)))
          setOpen((o) => !o)
        }}
        onKeyDown={key}
      >
        <span>{value}</span>
        <svg width="8" height="5" viewBox="0 0 8 5" aria-hidden="true">
          <path d="M.5.5 4 4 7.5.5" fill="none" stroke="currentColor" strokeWidth="1.1" />
        </svg>
      </button>
      {open && (
        <ul role="listbox" id={`${id}-list`} aria-label={label}>
          {options.map((o, i) => (
            <li
              key={o}
              id={optionId(i)}
              role="option"
              aria-selected={o === value}
              className={`${o === value ? 'chosen' : ''}${i === active ? ' active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(o)
              }}
            >
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
