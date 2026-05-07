import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'

interface NotificationHoursSelectorProps {
  selected: number[]
  onChange: (hours: number[]) => void
  showTimezone?: boolean
  hint?: string
}

export function NotificationHoursSelector({
  selected,
  onChange,
  showTimezone = true,
  hint,
}: NotificationHoursSelectorProps) {
  const { t } = useTranslation()
  const { user } = useAuth()

  const toggleHour = (h: number) => {
    onChange(
      selected.includes(h) ? selected.filter((x) => x !== h) : [...selected, h].sort((a, b) => a - b)
    )
  }

  const selectAll = () => onChange(Array.from({ length: 24 }, (_, i) => i))
  const clearAll = () => onChange([])

  return (
    <div className="space-y-1.5">
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {showTimezone && (
        <p className="text-xs text-muted-foreground">({user?.timezone || 'UTC'})</p>
      )}

      <div className="grid grid-cols-6 gap-1.5">
        {Array.from({ length: 24 }, (_, i) => i).map((h) => {
          const isSelected = selected.includes(h)
          return (
            <button
              key={h}
              type="button"
              onClick={() => toggleHour(h)}
              className={cn(
                'py-1.5 rounded-md text-xs font-medium transition-colors border',
                isSelected
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-input hover:border-primary/50'
              )}
            >
              {h}
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={selectAll} className="text-xs text-primary hover:underline">
          {t('common.selectAll')}
        </button>
        <span className="text-xs text-muted-foreground">/</span>
        <button type="button" onClick={clearAll} className="text-xs text-primary hover:underline">
          {t('channels.notificationHoursClear')}
        </button>
        {selected.length === 0 && (
          <span className="text-xs text-muted-foreground ml-auto">
            {t('channels.notificationHoursNoLimit')}
          </span>
        )}
      </div>
    </div>
  )
}
