
# FeedGenerator — пользовательское API

## Базовые
- `GET /` — список файлов в `FILES_DIR`, кнопка «Сгенерировать YML».
- `GET /download/:name` — скачать файл.
- `GET /healthz` — проверка живости.

## Документация
- `GET /view/API.md` — красивый просмотр этого файла (GitHub‑стиль).

## Загрузка файлов
- `POST /upload/:name` (body: binary) — загрузить файл до 200 MB.
- `POST /upload-multi` (`multipart/form-data`, поле `files`) — несколько файлов.

## Работа с YML
- `POST /api/feed/yml/build` — собрать все доступные фиды (если `SPREADSHEET_IDS` пусто — авто‑поиск через Drive API).
- `GET /api/feed/yml/download/:name` — скачать конкретный фид.

### Примечание по времени
Автогенерация настроена на **каждый понедельник 10:00 МСК** (в `systemd.timer` это 07:00 UTC).
