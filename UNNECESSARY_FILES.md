# Список потенциально ненужных файлов

## Файлы для удаления:

### Временные файлы:
- `server.js.backup` - бэкап старой версии server.js
- `temp_server.js` - временный файл сервера
- `commit_message.txt` - временный файл для commit сообщений (уже удален)
- `commit_message2.txt` - временный файл для commit сообщений (уже удален)
- `commit_message3.txt` - временный файл для commit сообщений (уже удален)

### Старые build папки:
- `dist_fixed/` - старая версия сборки
- `dist_new/` - старая версия сборки
- `dist_updated/` - старая версия сборки
- `build/` - временные build файлы (пересоздаются при сборке)

### Старые Electron ресурсы (если остались):
- `chrome_100_percent.pak`
- `chrome_200_percent.pak`
- `d3dcompiler_47.dll`
- `dxcompiler.dll`
- `dxil.dll`
- `ffmpeg.dll`
- `icudtl.dat`
- `libEGL.dll`
- `libGLESv2.dll`
- `resources.pak`
- `snapshot_blob.bin`
- `v8_context_snapshot.bin`
- `vk_swiftshader.dll`
- `vk_swiftshader_icd.json`
- `vulkan-1.dll`
- `LICENSE.electron.txt`
- `LICENSES.chromium.html`
- `Uninstall Vencord.exe`
- `Vencord.exe`

### Документация (устаревшая):
- `ELECTRON_FIX_REPORT.md` - старый отчет о исправлениях
- `PROJECT_ANALYSIS.md` - старый анализ проекта
- `setup-nexo-local.md` - возможно устаревшая инструкция
- `ROADMAP.md` - возможно устаревший roadmap

### Папки:
- `locales/` - старые локали Electron
- `resources/` - старые ресурсы Electron
- `your_directory/` - неясная папка

## Примечание:

**Эти файлы НЕ удалялись автоматически по вашему запросу.**

Вы можете удалить их вручную после проверки:
```bash
# Удаление временных файлов
Remove-Item server.js.backup, temp_server.js

# Удаление старых build папок
Remove-Item -Recurse -Force dist_fixed, dist_new, dist_updated, build

# Удаление старых Electron ресурсов
Remove-Item *.dll, *.pak, *.dat, *.bin, *.json, LICENSE*.txt, LICENSE*.html, *.exe
```

Generated build файлы в `dist/` не должны коммититься в Git благодаря обновленному `.gitignore`.
