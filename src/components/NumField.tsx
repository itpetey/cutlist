import { useEffect, useRef, useState } from 'react'

interface NumFieldProps {
  value: number | null
  onChange: (value: number | null) => void
  nullable?: boolean
  placeholder?: string
  ariaLabel: string
  className?: string
  title?: string
}

function toText(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '' : String(value)
}

export function NumField({
  value,
  onChange,
  nullable = false,
  placeholder,
  ariaLabel,
  className,
  title,
}: NumFieldProps) {
  const [text, setText] = useState(() => toText(value))
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!focused) setText(toText(value))
  }, [value, focused])

  return (
    <input
      ref={inputRef}
      className={['field num', className].filter(Boolean).join(' ')}
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      value={text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      title={title}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        setText(toText(value))
        // Keep the numeric value in sync with anything left in the box.
        if (nullable && text.trim() === '') onChange(null)
      }}
      onChange={(event) => {
        const next = event.target.value
        setText(next)
        if (next.trim() === '') {
          onChange(nullable ? null : 0)
          return
        }
        const parsed = Number.parseFloat(next)
        if (Number.isFinite(parsed)) onChange(parsed)
      }}
    />
  )
}
