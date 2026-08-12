FROM node:18-alpine

# Установка зависимостей для better-sqlite3
RUN apk add --no-cache python3 make g++

# Рабочая директория
WORKDIR /app

# Копирование package files
COPY package*.json ./

# Установка зависимостей
RUN npm ci --only=production

# Копирование исходных файлов
COPY . .

# Сборка клиента
RUN npm run build:client

# Создание директорий
RUN mkdir -p data uploads tmp

# Открытие порта
EXPOSE 4000

# Переменные окружения
ENV NODE_ENV=production
ENV PORT=4000
ENV USE_MEMORY_SESSION=true

# Запуск сервера
CMD ["node", "server.js"]