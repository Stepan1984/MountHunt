import { useEffect, useState } from 'react'
import { loadSiteData } from '../lib/data'
import type { SiteData } from '../types'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: SiteData }

export function useSiteData(): State {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    loadSiteData()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Ошибка загрузки данных',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
