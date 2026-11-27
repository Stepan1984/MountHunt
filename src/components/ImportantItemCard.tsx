import { Link } from 'react-router-dom'
import { LinkedText } from './LinkedText'
import { formatImportantDate, publicImportantBody } from '../lib/data'
import { newsSourceLabel } from '../lib/links'
import type { ImportantItem } from '../types'

type Props = {
  item: ImportantItem
  resortName?: string
}

/**
 * Shared Important / news card: blue MountHunt resort link in the title,
 * visible source link to TG/VK/original when sourceUrl is present.
 */
export function ImportantItemCard({ item, resortName }: Props) {
  const titleStartsWithResort = Boolean(
    resortName && item.resortId && item.title.startsWith(resortName),
  )
  const body = publicImportantBody(item.body)
  const sourceUrl = item.sourceUrl?.trim() || ''
  const sourceKind = sourceUrl ? newsSourceLabel(sourceUrl) : ''

  return (
    <li className="important__item">
      {item.publishedAt ? (
        <div className="important__meta">
          <time dateTime={item.publishedAt}>{formatImportantDate(item.publishedAt)}</time>
        </div>
      ) : null}
      <h3>
        {titleStartsWithResort && resortName && item.resortId ? (
          <>
            <Link to={`/resort/${item.resortId}`}>{resortName}</Link>
            {item.title.slice(resortName.length)}
          </>
        ) : (
          item.title
        )}
      </h3>
      {body && (
        <p>
          <LinkedText text={body} />
        </p>
      )}
      {sourceUrl ? (
        <p className="important__source">
          <a href={sourceUrl} rel="noopener noreferrer" target="_blank">
            {sourceKind === 'Источник' ? 'Источник' : `Источник · ${sourceKind}`}
          </a>
        </p>
      ) : null}
    </li>
  )
}
