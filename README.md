# RNL Food - School Canteen Service

Веб-сервис для заказа еды в столовой Ришельевского научного лицея.

## Возможности

- 📱 Удобный веб-интерфейс для заказа еды
- 🍽️ Меню столовой с категориями блюд
- 💰 Пополнение баланса
- 🎁 Система промокодов и скидок
- 📊 История заказов
- 🔐 Безопасная аутентификация
- 🏆 Система достижений
- 📋 Планировщик питания
- ⭐ Избранное

## Технологии

- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Node.js, Express
- **Database:** PostgreSQL (Supabase)
- **Authentication:** JWT

## Установка

```bash
# Установка зависимостей
npm install

# Настройка базы данных (создание таблиц и тестовых данных)
npm run setup-db

# Запуск сервера
npm start
```

## Настройка

Создайте файл `.env` со следующими переменными:

```env
DATABASE_URL=postgresql://user:password@host:port/database
JWT_SECRET=your-secret-key
PORT=3000
```

## Структура БД

- **users** - Пользователи (id, username, password, fullname, role, balance, age, parents, grade)
- **menu_items** - Меню (id, name, description, price, category, calories, allergens, rating, is_new, is_popular)
- **orders** - Заказы (id, user_id, items, total, status)
- **promo_codes** - Промокоды (id, code, discount, expires_at)
- **notifications** - Уведомления (id, user_id, title, message, type, is_read)
- **achievements** - Достижения
- **user_achievements** - Достижения пользователей
- **food_diary** - Дневник питания
- **meal_plans** - Планы питания
- **favorites** - Избранное
- **support_staff** - Поддержка
- **chat_messages** - Сообщения чата

## API Endpoints

### Аутентификация
- `POST /api/register` - Регистрация
- `POST /api/login` - Вход
- `POST /api/logout` - Выход

### Меню
- `GET /api/menu` - Получить меню
- `GET /api/categories` - Получить категории

### Промокоды
- `POST /api/validate-promo` - Проверить промокод

### Заказы
- `POST /api/orders` - Создать заказ
- `GET /api/orders/history` - История заказов
- `GET /api/orders/:id` - Получить заказ

### Баланс
- `POST /api/topup` - Пополнить баланс

### Профиль
- `POST /api/update-profile` - Обновить профиль

### Уведомления
- `GET /api/notifications` - Получить уведомления
- `PUT /api/notifications/:id/read` - Отметить как прочитанное
- `PUT /api/notifications/read-all` - Отметить все как прочитанные

### Админ
- `GET /api/admin/stats` - Статистика
- `GET /api/admin/orders` - Все заказы
- `PUT /api/admin/orders/:id/status` - Обновить статус заказа
- `POST /api/admin/notifications` - Отправить уведомление
- `POST /api/admin/notifications/broadcast` - Рассылка

### Система
- `GET /api/health` - Проверка соединения с БД

## Скрипты

```bash
npm start        # Запуск сервера
npm run dev     # Запуск в режиме разработки
npm run setup-db # Настройка базы данных
```

## Промокоды

- `WELCOME10` - Скидка 10%
- `FIRSTORDER` - Скидка 15%
- `LYCEUM20` - Скидка 20%
- `STUDENT5` - Скидка 5%

## Разработка

Создано: DANYLENKO DANIIL, DMITRIEV KOLYA