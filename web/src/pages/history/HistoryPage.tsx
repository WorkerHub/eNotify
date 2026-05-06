import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle, XCircle, History, Bell } from 'lucide-react'
import { api } from '@/lib/api'
import type { NotificationHistory } from '@/types'

export function HistoryPage() {
  const { t } = useTranslation()
  const [history, setHistory] = useState<NotificationHistory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchHistory = useCallback(async () => {
    try {
      const data = await api.get<NotificationHistory[]>('/me/notification-history?limit=200')
      setHistory(data)
    } catch (e: any) {
      setError(e.message || t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('history.title')}</h1>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      ) : history.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <History className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>{t('history.noData')}</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {[
                    t('history.title_col'),
                    t('history.channel'),
                    t('common.status'),
                    t('history.time'),
                  ].map((h) => (
                    <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {history.map((h) => (
                  <tr key={h.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium truncate max-w-xs">{h.title}</p>
                      {h.item_name && (
                        <p className="text-xs text-muted-foreground">{h.item_name}</p>
                      )}
                      {h.error && (
                        <p className="text-xs text-destructive truncate max-w-xs">{h.error}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="uppercase text-muted-foreground">{h.channel}</span>
                    </td>
                    <td className="px-4 py-3">
                      {h.success ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-600 bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded-full">
                          <CheckCircle className="w-3 h-3" />
                          {t('history.success')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">
                          <XCircle className="w-3 h-3" />
                          {t('history.failed')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {new Date(h.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden space-y-3">
            {history.map((h) => (
              <div key={h.id} className="bg-card rounded-xl border p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{h.title}</p>
                    {h.item_name && (
                      <p className="text-xs text-muted-foreground">{h.item_name}</p>
                    )}
                  </div>
                  {h.success ? (
                    <span className="inline-flex items-center gap-1 text-xs text-green-600 bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded-full shrink-0">
                      <CheckCircle className="w-3 h-3" />
                      {t('history.success')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-destructive bg-destructive/10 px-2 py-0.5 rounded-full shrink-0">
                      <XCircle className="w-3 h-3" />
                      {t('history.failed')}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="uppercase">{h.channel}</span>
                  <span>{new Date(h.created_at).toLocaleString()}</span>
                </div>
                {h.error && (
                  <p className="text-xs text-destructive truncate">{h.error}</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
