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
npm run scrape -- --wave=2                  # только P2
npm run scrape -- --skip-optional           # без Красного озера
SCRAPE_DELAY_MS=2000 npm run scrape         # пауза между хостами
```

**Волна 1 (P1):** `tuutari-park`, `zolotaya-dolina`, `lazurnye-ozera`, `puhtolova-gora`, `yukki` (PDF → `pdftotext` / OCR tesseract).  
**Волна 2 (P2):** `krasnoe-ozero` (CSV цен + CSV графика), `snezhny`, `drop-park`, `okhta-park`.  
**Позже (P3):** `igora` (Playwright), `severny-sklon` (manual/partial).

Для Юкки локально желательны:

```bash
sudo apt-get install -y poppler-utils tesseract-ocr tesseract-ocr-rus
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
- ставит poppler + tesseract, `npm ci`, `npm run scrape`
- коммитит `public/data` (+ seed-фикс webcam Красного озера), если есть diff

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
| `npm run data:refresh` | Обновить `public/data` из seed (без сети) |
