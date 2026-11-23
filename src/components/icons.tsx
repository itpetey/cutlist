export function Logo() {
  return (
    <svg width="32" height="32" viewBox="0 0 30 30" aria-hidden="true" className="logo">
      <defs>
        <linearGradient id="cutlist-logo" x1="0" y1="0" x2="30" y2="30">
          <stop stopColor="#cf8126" />
          <stop offset="1" stopColor="#8a4a10" />
        </linearGradient>
      </defs>
      <rect width="30" height="30" rx="9" fill="url(#cutlist-logo)" />
      <rect x="7" y="8" width="16" height="3.2" rx="1.6" fill="#fff8ec" />
      <rect x="7" y="13.4" width="11" height="3.2" rx="1.6" fill="#fff8ec" opacity=".82" />
      <rect x="7" y="18.8" width="14" height="3.2" rx="1.6" fill="#fff8ec" opacity=".64" />
    </svg>
  )
}

export function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M2.5 4h11M6 4V2.8c0-.4.3-.8.8-.8h2.4c.5 0 .8.4.8.8V4m2.2 0-.5 8.2c0 .9-.8 1.6-1.7 1.6H5.9c-.9 0-1.7-.7-1.7-1.6L3.7 4M6.5 6.5v4M9.5 6.5v4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function BoltIcon() {  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M9.2 1.5 3.4 9h3.4l-.8 5.5L12.6 6.8H9.2l0-5.3Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.5 5.5v-1A1.5 1.5 0 0 0 9 3H3.5A1.5 1.5 0 0 0 2 4.5V10a1.5 1.5 0 0 0 1.5 1.5h1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="m3 8.5 3.2 3.2L13 4.8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function PrintIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M4.5 6V2.8h7V6M4.5 12H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1.5M4.5 9.5h7V13h-7V9.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function AlertIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M10 2.8 18 17H2L10 2.8Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 7.4v4.2M10 14.3v.1" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

export function InfoIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 9v4.6M10 6.4v.1" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />
}

export function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <rect x="3.2" y="3.2" width="9.6" height="9.6" rx="1.6" fill="currentColor" />
    </svg>
  )
}
