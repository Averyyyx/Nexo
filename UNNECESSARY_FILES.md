# Список потенциально ненужных файлов

## Категория 1: ТОЧНО используется
- server.js - основной файл сервера
- electron/main.js - главный процесс Electron
- electron/splash.html - splash screen
- electron/welcome.html - welcome screen
- electron/titlebar.html - кастомный title bar
- electron/preload.js - проверка показала что файла нет в проекте
- scripts/prepare-node.js - подготовка runtime node.exe
- scripts/prepare-public.js - подготовка public
- package.json - конфигурация проекта
- electron-builder.yml - конфигурация Electron builder
- build/runtime/node.exe - runtime для embedded server (85MB, нужен)

## Категория 2: ВЕРОЯТНО используется
- assets/**/* - SVG иконки для конвертации
- electron/icons/**/* - PNG/ICO иконки для приложения
- data/**/* - данные SQLite базы (в development)
- uploads/**/* - загруженные файлы (в development)

## Категория 3: НЕ используется (можно удалить)

### Временные файлы:
- server.js.backup - бэкап старой версии server.js
- temp_server.js - временный файл сервера
- commit_message.txt - временный файл для commit сообщений
- commit_message2.txt - временный файл для commit сообщений  
- commit_message3.txt - временный файл для commit сообщений

### Старые build папки:
- dist/ - старая версия сборки (заблокирована после запуска)
- dist_fixed/ - старая версия сборки
- dist_new/ - старая версия сборки
- dist_updated/ - старая версия сборки
- dist_test/ - текущая тестовая сборка (нужно переименовать в dist)

### Устаревшая документация:
- ELECTRON_FIX_REPORT.md - старый отчет о исправлениях
- PROJECT_ANALYSIS.md - старый анализ проекта
- setup-nexo-local.md - возможно устаревшая инструкция
- ROADMAP.md - возможно устаревший roadmap
- CHANGELOG.md - можно удалить или обновить (есть в Git)

### Устаревшие Electron файлы:
- locales/ - старые локали Electron
- resources/ - старые ресурсы Electron
- your_directory/ - неясная папка

## Категория 4: НЕИЗВЕСТНО (требует проверки)

### Не проверены:
- Dockerfile - может использоваться для production
- docker-compose.yml - может использоваться для production
- deploy.sh - может использоваться для deployment
- .github/workflows/deploy.yml - может использоваться для CI/CD

## Рекомендации

### Безопасно удалить:
- server.js.backup
- temp_server.js
- commit_message.txt
- commit_message2.txt
- commit_message3.txt
- dist_fixed/
- dist_new/
- dist_updated/
- ELECTRON_FIX_REPORT.md
- PROJECT_ANALYSIS.md
- ROADMAP.md

### Проверить перед удалением:
- Dockerfile, docker-compose.yml, deploy.sh, .github/workflows/deploy.yml
- locales/, resources/, your_directory/

### Переименовать:
- dist_test/ → dist/ (для стандартного output directory)

## Примечание

Этот список создан для анализа. Удаление НЕ выполнялось автоматически по требованию эксперта. Все изменения согласованы с сохранением архитектуры проекта.
