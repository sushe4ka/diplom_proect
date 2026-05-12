@echo off
echo ==========================================
echo   Запуск BeautyBooking (Локальный сервер)
echo ==========================================
echo.

:: Проверяем, установлен ли Python
python --version >nul 2>&1
if %errorlevel% == 0 (
    echo [OK] Python найден. Запускаем сервер...
    start http://localhost:8080
    python -m http.server 8080
    goto end
)

py --version >nul 2>&1
if %errorlevel% == 0 (
    echo [OK] Python (py) найден. Запускаем сервер...
    start http://localhost:8080
    py -m http.server 8080
    goto end
)

:: Если Python нет, пробуем Node.js
node --version >nul 2>&1
if %errorlevel% == 0 (
    echo [OK] Node.js найден. Запускаем сервер...
    start http://localhost:8080
    npx http-server -p 8080
    goto end
)

echo [ОШИБКА] Не найден ни Python, ни Node.js!
echo Для работы сайта нужен локальный сервер.
echo Пожалуйста, установите Python с python.org или используйте VS Code + Live Server.
pause
:end