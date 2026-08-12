#!/bin/bash

# Скрипт для развертывания Nexo на сервере

echo "🚀 Начинаем развертывание Nexo..."

# Проверка Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js не установлен. Пожалуйста, установите Node.js 18+"
    exit 1
fi

# Проверка Git
if ! command -v git &> /dev/null; then
    echo "❌ Git не установлен. Пожалуйста, установите Git"
    exit 1
fi

# Установка зависимостей
echo "📦 Установка зависимостей..."
npm install

# Сборка приложения
echo "🔨 Сборка приложения..."
npm run build:app

# Создание директорий
echo "📁 Создание директорий..."
mkdir -p data uploads tmp

# Настройка переменных окружения
if [ ! -f .env ]; then
    echo "⚙️  Создание .env файла..."
    cat > .env << EOF
NODE_ENV=production
PORT=4000
CLIENT_ORIGIN=https://nexo.com
CORS_ORIGIN=https://nexo.com
USE_MEMORY_SESSION=true
SESSION_SECRET=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 32)
EOF
    echo "✅ .env файл создан с секретными ключами"
else
    echo "✅ .env файл уже существует"
fi

# Установка PM2 если не установлен
if ! command -v pm2 &> /dev/null; then
    echo "📦 Установка PM2..."
    npm install -g pm2
fi

# Остановка текущего процесса если есть
echo "🛑 Остановка текущего процесса..."
pm2 stop nexo 2>/dev/null || true
pm2 delete nexo 2>/dev/null || true

# Запуск приложения
echo "🚀 Запуск приложения..."
pm2 start server.js --name nexo

# Сохранение PM2 конфигурации
pm2 save

# Настройка автозапуска
pm2 startup

echo "✅ Развертывание завершено!"
echo "🌐 Приложение доступно на http://localhost:4000"
echo "📊 Статус: pm2 status"
echo "📝 Логи: pm2 logs nexo"