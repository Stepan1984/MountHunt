# MountHunt

Агрегатор горнолыжных курортов Санкт-Петербурга и Ленинградской области.

Сайт на русском: карточки курортов, интерактивная карта (Leaflet + OSM), раздел «Важное», страницы курортов со ссылками на сайт и камеры. Цены и часы — из scrape дважды в день официальных публичных страниц (волны 1–2) либо плейсхолдеры.

**Стек:** Vite + React + TypeScript · статика для GitHub Pages · Node scrapers (cheerio / PDF+OCR).

---

## Локальный запуск

```bash
npm install
npm run dev
```

Откроется dev-сервер Vite.

Сборка:

```bash
npm run build
npm run preview
```

По умолчанию `base` = `/` (кастомный домен **mounthunt.ru** на корне сайта). Для project-pages пути снова: `VITE_BASE=/MountHunt/ npm run build`.

---

## GitHub Pages

Продакшен-адрес: **https://mounthunt.ru/**  
(запасной project URL: `https://stepan1984.github.io/MountHunt/` — после смены `base` на `/` этот путь уже не обслуживает ассеты).

### Как включить (обязательно один раз)

Workflow собирает `dist`, но **деплой падает с 404**, пока Pages не включён в настройках репозитория (`has_pages: false` → API `GET /pages` = 404).

1. Откройте **[Settings → Pages](https://github.com/Stepan1984/MountHunt/settings/pages)**.
2. В блоке **Build and deployment** → **Source** выберите **GitHub Actions**  
   (не «Deploy from a branch» / не папка `/docs`).
3. Сохраните / просто закройте страницу — GitHub создаст сайт Pages и environment `github-pages`.
4. Перезапустите workflow: **Actions → Deploy to GitHub Pages → Run workflow**  
   (или сделайте пустой push в `main`).
5. После зелёного `deploy` откройте URL из Settings → Pages или из лога шага Deploy.

Репозиторий **публичный** — GitHub Pro для Pages не нужен. Если сделаете private без Pro, Pages снова перестанет работать.

### Кастомный домен `mounthunt.ru`

В репозитории лежит `public/CNAME` → `mounthunt.ru` (копируется в `dist` при сборке). Владельцу репозитория нужно один раз:

1. **Settings → Pages → Custom domain** → ввести `mounthunt.ru` и сохранить (GitHub проверит DNS).
2. Включить **Enforce HTTPS** после успешной проверки сертификата.
3. DNS у регистратора:

| Тип | Имя | Значение |
|-----|-----|----------|
| **A** | `@` (apex) | `185.199.108.153` |
| **A** | `@` | `185.199.109.153` |
| **A** | `@` | `185.199.110.153` |
| **A** | `@` | `185.199.111.153` |
| **AAAA** (опционально) | `@` | `2606:50c0:8000::153` … `8003::153` (см. [документацию GitHub](https://docs.github.com/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)) |
| **CNAME** (рекомендуется) | `www` | `stepan1984.github.io` |

Альтернатива apex: если DNS поддерживает **ALIAS/ANAME**, можно указать `stepan1984.github.io` вместо A-записей. После настройки www можно включить редирект apex ↔ www в Settings → Pages.

---

## Данные и scrape

| Файл | Назначение |
|------|------------|
| `data/seed/resorts.json` | Исходный каталог курортов (seed) |
| `public/data/resorts.json` | Публикуемый каталог |
| `public/data/hours.json` | Часы работы |
| `public/data/prices.json` | Цены |
| `public/data/important.json` | Блок «Важное» |
| `public/data/meta.json` | Время последнего обновления + статус прогона |

### Локальный scrape

```bash
npm run scrape
```

Опции:

```bash
npm run scrape -- --dry-run                 # без записи файлов
npm run scrape -- --only=tuutari-park,snezhny
npm run scrape -- --wave=3                  # только P3
npm run test:scrape                         # unit-тесты парсеров / fail-soft
SCRAPE_DELAY_MS=2000 npm run scrape         # пауза между хостами
IGORA_HTML_DIR=data/snapshots/igora npm run scrape -- --only=igora   # offline snapshot (opt-in)
```

**Волна 1 (P1):** `tuutari-park`, `zolotaya-dolina`, `lazurnye-ozera`, `puhtolova-gora`, `yukki` (PDF → `pdftotext` / OCR tesseract).  
**Волна 2 (P2):** `krasnoe-ozero` (CSV цен + CSV графика), `snezhny` (часы `partial` без Playwright), `drop-park`, `okhta-park`.  
**Волна 3 (P3):** `igora` (Playwright → cheerio; bundled snapshot только через `IGORA_HTML_DIR` / `IGORA_ALLOW_SNAPSHOT`), `severny-sklon` (ski-pass `unavailable`, без цен с агрегаторов).

Для Юкки локально желательны:

```bash
sudo apt-get install -y poppler-utils tesseract-ocr tesseract-ocr-rus
```

Для Игоры (локально / CI):

```bash
npx playwright install --with-deps chromium
```

Поведение при сбое: прошлый снимок в `public/data` сохраняется, у курорта `status: failed`.

User-Agent: `MountHuntBot/0.1 (+https://github.com/Stepan1984/MountHunt; …)`.

Seed-обновление без сети:

```bash
npm run data:refresh
```

### Workflow цен / часов (дважды в день)

`.github/workflows/daily-data-refresh.yml`:

- **cron** `0 7 * * *` и `0 19 * * *` (07:00 / 19:00 UTC = 10:00 / 22:00 Europe/Moscow) + ручной `workflow_dispatch`
- ставит poppler + tesseract, `npm ci`, Playwright Chromium, `npm run scrape` (волны 1–3)
- коммитит `public/data` (+ seed-фиксы), если есть diff
- Igora: live Playwright only in Actions (no `IGORA_HTML_DIR` / `IGORA_ALLOW_SNAPSHOT`; scraper also refuses snapshots when `CI`/`GITHUB_ACTIONS` is set). Offline HTML remains local opt-in.

### «Важное» / новости каждый час

`.github/workflows/important-refresh.yml`:

- **cron** `0 * * * *` (каждый час в :00 UTC ≈ каждый час в :00 Europe/Moscow) + `workflow_dispatch`
- лёгкий HTTP-only scrape (`npm run scrape:important`) — без Playwright/OCR; только news/important
- обновляет `public/data/important.json` (+ метка в `meta.json`); push на `main` запускает Deploy to GitHub Pages
- **fail-soft**: сбой одного курорта сохраняет прошлые пункты по нему; job не валится из‑за частичных ошибок
- на карточках «Важного» — `publishedAt` (дата новости/графика/страницы с источника); время scrape только в «Снимок» (`meta.importantScrapedAt`)

---

## Структура страниц

- `/` — бренд MountHunt, карта, «Важное», список курортов
- `/news` — лента новостей курортов
- `/resort/:id` — детали: локация, часы, цены, камера, сайт
- `/about` — источники и дисклеймер
- `/contacts` — контакты проекта

На карте по умолчанию только курорты со статусом `active` и координатами. Неясные/закрытые — во втором списке.

---

## SEO (robots / sitemap)

В `public/` лежат `robots.txt` (Allow all) и `sitemap.xml` с абсолютными URL `https://mounthunt.ru/…` (главная, `/about`, `/news`, `/contacts`, каждый `/resort/{id}` из `resorts.json`). Vite копирует их в корень `dist`. Пересборка sitemap: `npm run sitemap` (также вызывается из `npm run build`).

Отправка в поиск (один раз после деплоя):

1. **Google** — [Search Console](https://search.google.com/search-console) → добавить ресурс `https://mounthunt.ru` → Sitemaps → `https://mounthunt.ru/sitemap.xml`.
2. **Яндекс** — [Вебмастер](https://webmaster.yandex.ru/) → добавить сайт → Индексирование → Файлы Sitemap → тот же URL.

---

## Скрипты

| Команда | Описание |
|---------|----------|
| `npm run dev` | Разработка |
| `npm run sitemap` | Пересобрать `public/sitemap.xml` из `resorts.json` |
| `npm run build` | Production-сборка (включая sitemap) |
| `npm run preview` | Просмотр сборки |
| `npm run scrape` | Сбор цен/часов → `public/data` |
| `npm run scrape:important` | Лёгкий сбор блока «Важное» → `important.json` |
| `npm run data:refresh` | Обновить `public/data` из seed (без сети) |
