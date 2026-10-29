#!/bin/bash
#
# run.sh — запуск бэкенда и веб-интерфейса.
#
# Запуск:  ./run.sh
# Бэкенд:    http://localhost:5000
# Фронтенд:  открывает index.html браузером (или доступен статически)

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

# Убедимся, что Ollama запущен
if ! pgrep -x "ollama" >/dev/null 2>&1; then
    echo "Запуск ollama serve..."
    nohup ollama serve > /tmp/ollama.log 2>&1 &
    sleep 2
fi

# Убедимся, что модель загружена
if ! ollama list 2>/dev/null | grep -q "^gemma3"; then
    echo "Модель gemma3 не найдена. Запустите ./setup.sh сначала."
    exit 1
fi

# Создадим папки, если их нет
mkdir -p "$PROJECT_DIR/sessions" "$PROJECT_DIR/uploads"

# Определяем локальный IP-адрес для доступа из сети
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -z "$LOCAL_IP" ]; then
    LOCAL_IP="$(ip -4 addr show scope global 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -n1)"
fi

echo "=================================================="
echo "  Запуск бэкенда Gemma 3 Web Interface"
echo "  Backend API : http://0.0.0.0:5000"
if [ -n "$LOCAL_IP" ]; then
    echo "  Доступ из сети : http://$LOCAL_IP:5000"
fi
echo "  Откройте http://$LOCAL_IP:5000 в браузере с любого компа сети"
echo "=================================================="

# Запуск Flask бэкенда (0.0.0.0 = доступ из локальной сети)
exec python3 "$PROJECT_DIR/backend/app.py"
