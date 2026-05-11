import { useTranslation } from 'react-i18next'

export function AboutPage() {
  const { t } = useTranslation()

  const stack = [
    'Cloudflare Workers',
    'Cloudflare D1 (SQLite)',
    'Hono.js',
    'React 19',
    'Vite',
    'Tailwind CSS v4',
  ]

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-bold">{t('about.title')}</h1>

      <div className="bg-card border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{t('about.version')}</span>
          <span className="text-sm font-mono font-medium">{__APP_VERSION__}</span>
        </div>
        <div className="border-t pt-4">
          <p className="text-sm text-muted-foreground leading-relaxed">{t('about.description')}</p>
        </div>
      </div>

      <div className="bg-card border rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold">{t('about.builtWith')}</h2>
        <ul className="space-y-1.5">
          {stack.map((item) => (
            <li key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-card border rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{t('about.sourceCode')}</span>
          <a
            href="https://github.com/workerhub/eNotify"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-primary hover:underline"
          >
            GitHub
          </a>
        </div>
        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-sm text-muted-foreground">{t('about.license')}</span>
          <span className="text-sm font-medium">MIT</span>
        </div>
      </div>
    </div>
  )
}
