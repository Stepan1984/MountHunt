import type { ReactNode, TableHTMLAttributes } from 'react'

type Props = {
  children: ReactNode
  /** Optional accessible label for the table. */
  'aria-label'?: string
  className?: string
} & Pick<TableHTMLAttributes<HTMLTableElement>, 'role'>

/**
 * Shared pine/ice data table shell: scroll wrap + bordered surface.
 * Use for skipass tariffs, flat price fallbacks, and hours periods.
 */
export function DataTable({ children, className, 'aria-label': ariaLabel }: Props) {
  const tableClass = className ? `mh-table ${className}` : 'mh-table'
  return (
    <div className="mh-table-wrap">
      <table className={tableClass} aria-label={ariaLabel}>
        {children}
      </table>
    </div>
  )
}
