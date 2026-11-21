# 🚀 Nexo — Next-Generation Open-Source Desktop Communication Platform

Nexo is a high-performance, modular desktop application designed as a modern, customizable alternative to Discord. Built with a robust full-stack architecture using **React, TypeScript, Node.js, and Electron**, Nexo provides seamless workspace synchronization, sub-120ms rendering latency, and native desktop window management.

## 🖼️ Interface Architecture Preview
Nexo 0.0.8 uses a Discord-inspired workspace with friends, direct messages, text and voice channels, notification counters, sound preferences, direct calls, and a compact draggable startup screen.

## 🛠️ Key Technical Specifications
* **Electron Core Integration:** Desktop-native performance utilizing optimized Chromium window management and secure IPC (Inter-Process Communication) layers.
* **Full-Stack Isolation:** Clean architectural split between the front-end client layer and the Node.js back-end infrastructure for scalable production.
* **Localization Ready:** Embedded `locales` subsystem built from the ground up for seamless multi-language distribution.
* **Advanced Automation:** Pre-configured test server routines (`test_server.js`) and logging mechanisms for granular debugging.

## 🤖 Future AI Roadmap
We are actively developing **Nexo AI Agents** driven by dedicated LLM APIs to facilitate:
1. Automated cross-channel moderation and workspace data indexing.
2. Context-aware developer co-pilot subroutines integrated directly into the chat view.


## Проверка интерфейса 0.0.8

Для проверки положения нижней панели в разных размерах окна подготовлен Playwright-сценарий `scripts/e2e-ui.js`.

1. Установите Playwright и Chromium: `npm install --no-save playwright`, затем `npx playwright install chromium`.
2. Запустите локальный Nexo с тестовым аккаунтом и откройте его URL.
3. Задайте `NEXO_E2E_URL`, `NEXO_E2E_EMAIL`, `NEXO_E2E_PASSWORD` и выполните `node scripts/e2e-ui.js`.

Сценарий проверяет высоты 700/768/800/900/1080 px при масштабе 100/125/150%, три кнопки панели и отсутствие старого меню.

## Известные ограничения Nexo 0.0.8 Alpha

- Windows-установщик пока не подписан сертификатом издателя, поэтому Windows SmartScreen может показывать предупреждение.
- Голосовые каналы используют WebRTC mesh: комфортный предел — 5–6 участников. Для больших сообществ нужен SFU (например, LiveKit).
- Восстановление пароля по email недоступно до подключения почтового провайдера.
- Удаление аккаунта и изменение email не включены: связанные операции пока нельзя безопасно выполнить для всех данных пользователя.
- Камеру, демонстрацию экрана и звук необходимо проверить на реальных устройствах и между разными компьютерами.
- Отдельное окно голосового канала, Playwright E2E и быстрый ответ из Windows Toast пока не реализованы.
- Автообновление использует Windows NSIS-установщик и проверяет SHA-256; обновление поверх установленной 0.0.4 требует отдельной ручной проверки.
