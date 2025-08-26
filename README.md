
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

## Переменные окружения (.env)
Смотри `.env.example`.

## Сервис/таймер
Готовые юниты в `deploy/systemd/`. Таймер — каждый понедельник 10:00 МСК (07:00 UTC).
