
# FeedGenerator

Файловый сервер + генерация YML из Google Sheets с вытягиванием цены/данных со страницы товара.

## Быстрый старт
```bash
Положи на сервер 2 файла(sa.json и filesvc.run)
cd <Папка в которую положил файлы>  example /opt/
chmod +x filesvc.run
sudo ./filesvc.run --auto-discoveraa
# открой http://IP-Сервера:3001/
```


Настройка Google Cloud для File & Feed Service

Эта инструкция нужна, чтобы сервис мог читать данные из Google Sheets и Google Drive через Service Account (сервисную учётку) и файл ключа sa.json.

1. Создать проект в Google Cloud Console

Перейди в Google Cloud Console
.

В верхнем меню выбери или создай новый проект:

«Выбрать проект» → «Новый проект».

Дай понятное имя, например FeedGenerator.

Нажми «Создать».

2. Включить API

Для работы нужны два API:

Google Sheets API

Google Drive API

Чтобы включить:

В левом меню: APIs & Services → Library (Библиотека API).

Найди Google Sheets API → нажми Enable (Включить).

Повтори шаг для Google Drive API.

3. Создать Service Account

В левом меню: APIs & Services → Credentials (Учетные данные).

Нажми Create credentials → Service account.

Укажи имя, например: filesvc-service-account.

Роли можно не задавать (оставь по умолчанию — минимальные права).

Создай аккаунт.

4. Создать ключ sa.json

Открой созданный сервисный аккаунт.

Перейди во вкладку Keys.

Нажми Add key → Create new key.

Формат: JSON.

Скачанный файл сохрани как sa.json.

⚠️ Этот файл приватный. Не загружай его в публичный репозиторий!

5. Дать доступ к таблицам

Чтобы сервис смог читать таблицы:

Открой Google таблицу (Google Sheets).

Нажми Поделиться (Share).

Добавь e-mail сервисного аккаунта (он выглядит как filesvc-service-account@PROJECT_ID.iam.gserviceaccount.com).

Выдай права Читатель (Viewer) или Редактор (Editor).

Сохрани.


## Сервис/таймер
Готовые юниты в `deploy/systemd/`. Таймер — каждый понедельник 10:00 МСК (07:00 UTC).
