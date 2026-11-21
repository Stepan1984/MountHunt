# MountHunt

Агрегатор горнолыжных курортов Санкт-Петербурга и Ленинградской области.

Сайт на русском: карточки курортов, интерактивная карта (Leaflet + OSM), раздел «Важное», страницы курортов со ссылками на сайт и камеры. Цены и часы — из ежедневного scrape официальных публичных страниц (волны 1–2) либо плейсхолдеры.

**Стек:** Vite + React + TypeScript · статика для GitHub Pages · Node scrapers (cheerio / PDF+OCR).

---

## Локальный запуск

```bash
npm install
npm run dev
```

Откроется dev-сервер Vite. Для локальной разработки с корнем `/` можно так:

```bash
VITE_BASE=/ npm run dev
```

Сборка:

```bash
npm run build
npm run preview
```

По умолчанию `base` = `/MountHunt/` (имя репозитория на GitHub Pages).

---

## GitHub Pages

Сайт рассчитан на адрес:

`https://<user>.github.io/MountHunt/`

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

Если репозиторий переименуете — обновите `base` в `vite.config.ts` и `VITE_BASE` в `.github/workflows/deploy-pages.yml`.

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

### Ежедневный workflow

`.github/workflows/daily-data-refresh.yml`:

- **cron** `0 5 * * *` (05:00 UTC) + ручной `workflow_dispatch`
- ставит poppler + tesseract, `npm ci`, Playwright Chromium, `npm run scrape` (волны 1–3)
- коммитит `public/data` (+ seed-фиксы), если есть diff
- Igora: live Playwright only in Actions (no `IGORA_HTML_DIR` / `IGORA_ALLOW_SNAPSHOT`; scraper also refuses snapshots when `CI`/`GITHUB_ACTIONS` is set). Offline HTML remains local opt-in.

### «Важное» каждые 2 часа

`.github/workflows/important-refresh.yml`:

- **cron** `0 */2 * * *` (каждые 2 часа UTC) + `workflow_dispatch`
- лёгкий HTTP-only scrape (`npm run scrape:important`) — без Playwright/OCR
- обновляет `public/data/important.json` (+ метка в `meta.json`)
- **fail-soft**: сбой одного курорта сохраняет прошлые пункты по нему; job не валится из‑за частичных ошибок
- на карточках «Важного» — `publishedAt` (дата новости/графика/страницы с источника); время scrape только в «Снимок» (`meta.importantScrapedAt`)

---

## Структура страниц

- `/` — бренд MountHunt, карта, «Важное», список курортов
- `/resort/:id` — детали: локация, часы, цены, камера, сайт
- `/about` — источники и дисклеймер

На карте по умолчанию только курорты со статусом `active` и координатами. Неясные/закрытые — во втором списке.

---

## Скрипты

| Команда | Описание |
|---------|----------|
| `npm run dev` | Разработка |
| `npm run build` | Production-сборка |
| `npm run preview` | Просмотр сборки |
| `npm run scrape` | Сбор цен/часов → `public/data` |
| `npm run scrape:important` | Лёгкий сбор блока «Важное» → `important.json` |
| `npm run data:refresh` | Обновить `public/data` из seed (без сети) |
