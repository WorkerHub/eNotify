import { useTranslation } from "react-i18next";

export function AboutPage() {
  const { t } = useTranslation();

  const stack = [
    "Cloudflare Workers",
    "Cloudflare D1 (SQLite)",
    "Hono.js",
    "React 19",
    "Vite",
    "Tailwind CSS v4",
  ];

  return (
    <div className="max-w-lg space-y-8">
      <h1 className="text-heading">{t("about.title")}</h1>

      <div className="bg-card border rounded-lg p-4 md:p-6 shadow-1 space-y-4">
        <dl className="flex items-baseline justify-between">
          <dt className="text-caption text-muted-foreground">
            {t("about.version")}
          </dt>
          <dd className="text-body-strong font-mono tabular-nums">
            {__APP_VERSION__}
          </dd>
        </dl>
        <div className="border-t pt-4">
          <p className="text-body-sm text-muted-foreground">
            {t("about.description")}
          </p>
        </div>
      </div>

      <div className="bg-card border rounded-lg p-4 md:p-6 shadow-1 space-y-3">
        <h2 className="text-title">{t("about.builtWith")}</h2>
        <ul className="space-y-1.5">
          {stack.map((item) => (
            <li
              key={item}
              className="flex items-center gap-2 text-body-sm text-muted-foreground"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-card border rounded-lg p-4 md:p-6 shadow-1 space-y-3">
        <dl className="flex items-baseline justify-between">
          <dt className="text-caption text-muted-foreground">
            {t("about.sourceCode")}
          </dt>
          <dd>
            <a
              href="https://github.com/workerhub/eNotify"
              target="_blank"
              rel="noopener noreferrer"
              className="text-body-strong text-primary hover:underline"
            >
              GitHub
            </a>
          </dd>
        </dl>
        <dl className="flex items-baseline justify-between border-t pt-3">
          <dt className="text-caption text-muted-foreground">
            {t("about.license")}
          </dt>
          <dd className="text-body-strong">MIT</dd>
        </dl>
      </div>
    </div>
  );
}
