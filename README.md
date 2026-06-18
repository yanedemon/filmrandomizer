# Film Randomizer

Локальное веб-приложение для библиотеки фильмов, коллекций и случайного выбора.

## Возможности

- локальные пользователи с входом по логину и паролю, у каждого пользователя свои фильмы и коллекции;
- добавить фильм по названию и выбрать нужный вариант, если найдено несколько совпадений;
- импортировать список фильмов из TXT-файла;
- подтянуть карточку с постером, описанием и IMDb-рейтингом;
- получать русское название и русское описание через Wikidata/Wikipedia, когда они доступны;
- создавать, переименовывать, редактировать и удалять коллекции;
- отмечать фильмы как просмотренные;
- показывать библиотеку порциями по 15 фильмов;
- случайно выбрать фильм из непросмотренных в текущем разделе;
- раскрывать настройки выбора: учитывать просмотренные фильмы и фильтровать по длительности;
- использовать постоянный темный XENO-интерфейс с терминальным визуальным стилем.

## Запуск

В PowerShell из папки проекта:

```powershell
.\run.ps1
```

После запуска откройте:

```text
http://127.0.0.1:8000
```

Если Python доступен в PATH, можно запустить напрямую:

```powershell
python server.py serve
```

## Данные

По умолчанию используется локальная SQLite-база:

```text
data/filmrandomizer.sqlite
```

Путь к SQLite-базе можно вынести в конфиг окружения. Например:

```powershell
$env:FILMRANDOMIZER_DB_PATH="D:\filmrandomizer-data\filmrandomizer.sqlite"
.\run.ps1
```

Для Postgres установите зависимости и задайте `DATABASE_URL`:

```powershell
python -m pip install -r requirements.txt
$env:DATABASE_URL="postgresql://user:password@host:5432/dbname?sslmode=require"
.\run.ps1
```

Также поддерживается `FILMRANDOMIZER_DATABASE_URL`. Если `DATABASE_URL` или `FILMRANDOMIZER_DATABASE_URL` задан, приложение использует Postgres вместо SQLite.

Перенос из SQLite в Postgres:

```powershell
python server.py export backup.json
$env:DATABASE_URL="postgresql://user:password@host:5432/dbname?sslmode=require"
python server.py import backup.json
```

Дополнительные настройки для деплоя:

```text
DATABASE_URL                           подключение к Postgres
FILMRANDOMIZER_DATABASE_URL            альтернативная переменная подключения к Postgres
FILMRANDOMIZER_DB_PATH                 путь к SQLite-базе, если Postgres не включен
FILMRANDOMIZER_SESSION_TTL_SECONDS     срок жизни сессии, по умолчанию 30 дней
FILMRANDOMIZER_PASSWORD_ITERATIONS     число PBKDF2-итераций, по умолчанию 260000
```

Для переноса SQLite-версии без смены типа базы можно скопировать папку `data` в другой экземпляр проекта.

Также есть JSON export/import:

```powershell
python server.py export backup.json
python server.py import backup.json
```

Если системного Python нет, используйте тот же интерпретатор, который запускает `run.ps1`.

## Деплой на Render

В корне проекта есть `render.yaml` для Render Blueprint. Он создает Python Web Service с такими командами:

```text
Build Command: pip install -r requirements.txt
Start Command: python server.py serve --host 0.0.0.0
Health Check Path: /api/health
```

Render сам передает порт через переменную `PORT`, приложение использует ее по умолчанию.

Перед первым деплоем:

1. Запушьте проект в GitHub.
2. В Render выберите New -> Blueprint и подключите репозиторий.
3. Введите `DATABASE_URL` как secret/env var. Можно использовать Render Postgres, Neon или другой Postgres.
4. После первого успешного деплоя откройте выданный `onrender.com` URL.

Если нужно перенести текущую локальную SQLite-базу в Postgres:

```powershell
python server.py export backup.json
$env:DATABASE_URL="postgresql://user:password@host:5432/dbname?sslmode=require"
python server.py import backup.json
```

Free Render Web Service засыпает после простоя, а Free Render Postgres имеет временные ограничения. Для постоянного хранения лучше использовать paid Render Postgres или внешний managed Postgres.

## Источники фильмов

Поиск работает без ключей: русскоязычные варианты берутся из Wikidata, описание из русской Wikipedia, рейтинг и постер из Cinemeta.

## Импорт TXT

Файл должен быть `.txt`, названия фильмов разделяются запятыми:

```text
Собачий полдень, Славные парни, Крёстный отец
```

Если название содержит запятую, оберните его в двойные кавычки. Перед добавлением приложение покажет найденные варианты, чтобы можно было проверить спорные совпадения или пропустить отдельные строки.
