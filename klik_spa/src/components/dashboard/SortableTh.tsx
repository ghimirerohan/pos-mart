import type { ReactNode } from "react"
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react"

type SortDirection = "asc" | "desc"

interface SortableThProps {
  children: ReactNode
  /** Column id for aria-sort */
  sortKey: string
  active: boolean
  direction: SortDirection | null
  onSort: () => void
  className?: string
  title?: string
  align?: "left" | "right"
}

export function SortableTh({
  children,
  sortKey,
  active,
  direction,
  onSort,
  className = "",
  title,
  align = "left",
}: SortableThProps) {
  const justify = align === "right" ? "justify-end" : "justify-start"
  return (
    <th
      scope="col"
      className={`py-2 px-2 ${className}`}
      aria-sort={
        !active ? "none" : direction === "asc" ? "ascending" : "descending"
      }
    >
      <button
        type="button"
        id={`sort-${sortKey}`}
        title={title}
        onClick={onSort}
        className={`group inline-flex w-full min-w-0 items-center gap-0.5 ${justify} font-medium text-gray-500 transition hover:text-gray-900 dark:text-gray-400 dark:hover:text-white`}
      >
        <span className="truncate">{children}</span>
        <span className="inline-flex shrink-0 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300">
          {!active ? (
            <ChevronsUpDown className="w-3.5 h-3.5 opacity-50" aria-hidden />
          ) : direction === "asc" ? (
            <ArrowUp className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" aria-hidden />
          ) : (
            <ArrowDown className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" aria-hidden />
          )}
        </span>
      </button>
    </th>
  )
}
