# Настройка локальной работы с nexo.com

## Вариант 1: Локальная имитация (без реального домена)

Для локальной разработки проект уже настроен для работы с nexo.com API:

### Запуск локально:
```bash
# Сервер (имитирует бэкенд nexo.com)
npm run dev

# Клиент (будет пытаться подключиться к https://nexo.com)
npm run dev:client
```

**Примечание**: Локально клиент будет пытаться подключиться к реальному nexo.com, который может не существовать.

## Вариант 2: Использование реального домена nexo.com

Чтобы сделать nexo.com реально работающим, нужно:

### 1. Приобрести домен nexo.com
- Зарегистрировать домен у регистратора (GoDaddy, Namecheap, etc.)

### 2. Настроить DNS
- Добавить A запись указывающую на IP вашего сервера
- Настроить SSL сертификат (Let's Encrypt)

### 3. Подготовить сервер
- Установить Node.js на сервер (Ubuntu/Debian/CentOS)
- Установить Nginx/Apache
- Настроить firewall

### 4. Развернуть проект
```bash
# На сервере
git clone https://github.com/Averyyyx/Nexo.git
cd Nexo
npm install
npm run build:app
```

### 5. Настроить окружение
Создать `.env` файл на сервере:
```bash
NODE_ENV=production
CLIENT_ORIGIN=https://nexo.com
CORS_ORIGIN=https://nexo.com
PORT=4000
SESSION_SECRET=your-production-secret
JWT_SECRET=your-production-jwt-secret
```

### 6. Запустить с PM2
```bash
npm install -g pm2
pm2 start server.js --name nexo
pm2 save
pm2 startup
```

### 7. Настроить Nginx
```nginx
server {
    listen 80;
    server_name nexo.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name nexo.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Вариант 3: Бесплатный хостинг

Использовать бесплатные сервисы:
- **Vercel** + **Railway/Render** для бэкенда
- **Netlify** + **Heroku** 
- **GitHub Pages** + **Firebase Functions**

## Что я могу сделать сейчас:

1. Создать Dockerfile для контейнеризации
2. Настроить GitHub Actions для автоматического деплоя
3. Создать скрипты для легкого развертывания
4. Подготовить конфигурации для разных хостингов

Что из этого вы хотите, чтобы я сделал?