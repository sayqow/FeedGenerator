## Authors
- [@Sayqow](https://github.com/sayqow) — разработка и тестирование
- [@Unlalka](https://github.com/unlalka) — документация и идея 

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


# Настройка Google Cloud для File & Feed Service

Эта инструкция нужна, чтобы сервис мог читать данные из Google Sheets и Google Drive через **Service Account** (сервисную учётку) и файл ключа `sa.json`.

---

## 1. Создать проект в Google Cloud Console

1. Перейди в [Google Cloud Console](https://console.cloud.google.com/).
2. В верхнем меню выбери или создай новый проект:
   - **«Выбрать проект» → «Новый проект»**.
   - Дай понятное имя, например `FeedGenerator`.
   - Нажми **«Создать»**.

---

## 2. Включить API

Для работы нужны два API:
- **Google Sheets API**
- **Google Drive API**

Чтобы включить:
1. В левом меню: **APIs & Services → Library (Библиотека API)**.
2. Найди **Google Sheets API** → нажми **Enable (Включить)**.
3. Повтори шаг для **Google Drive API**.

---

## 3. Создать Service Account

1. В левом меню: **APIs & Services → Credentials (Учетные данные)**.
2. Нажми **Create credentials → Service account**.
3. Укажи имя, например: `filesvc-service-account`.
4. Роли можно не задавать (оставь по умолчанию — минимальные права).
5. Создай аккаунт.

---

## 4. Создать ключ `sa.json`

1. Открой созданный сервисный аккаунт.
2. Перейди во вкладку **Keys**.
3. Нажми **Add key → Create new key**.
4. Формат: **JSON**.
5. Скачанный файл **сохрани как `sa.json`**.

⚠️ Этот файл приватный. Не загружай его в публичный репозиторий!

---

## 5. Дать доступ к таблицам

Чтобы сервис смог читать таблицы:

1. Открой Google таблицу (Google Sheets).
2. Нажми **Поделиться** (Share).
3. Добавь e-mail сервисного аккаунта (он выглядит как `filesvc-service-account@PROJECT_ID.iam.gserviceaccount.com`).
4. Выдай права **Читатель** (Viewer) или **Редактор** (Editor).
5. Сохрани.

---


## Сервис/таймер
Готовые юниты в `deploy/systemd/`. Таймер — каждый понедельник 10:00 МСК (07:00 UTC).
