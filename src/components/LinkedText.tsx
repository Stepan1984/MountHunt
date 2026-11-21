import type { ReactNode } from 'react'
import { linkLabelForUrl, splitTextWithLinks } from '../lib/links'

type Props = {
  text: string
  className?: string
}

/**
 * Renders visitor-facing copy so absolute URLs become `<a href>` with
 * human-readable Russian labels (never raw slash paths as link text).
 */
export function LinkedText({ text, className }: Props) {
  const parts = splitTextWithLinks(text)
  const onlyLink =
    parts.length === 1 && parts[0]?.type === 'link'
      ? parts[0]
      : null

  if (onlyLink) {
    return (
      <a
        className={className}
        href={onlyLink.href}
        target="_blank"
        rel="noreferrer"
      >
        {onlyLink.label}
      </a>
    )
  }

  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (part.type === 'text') {
          return <span key={i}>{part.value}</span>
        }
        return (
          <a key={i} href={part.href} target="_blank" rel="noreferrer">
            {part.label}
          </a>
        )
      })}
    </span>
  )
}

type ExternalLinkProps = {
  href: string
  label?: string
  className?: string
  children?: ReactNode
}

/** External link with a Russian label derived from the URL when none given. */
export function ExternalLink({ href, label, className, children }: ExternalLinkProps) {
  return (
    <a className={className} href={href} target="_blank" rel="noreferrer">
      {children ?? label ?? linkLabelForUrl(href)}
    </a>
  )
}
