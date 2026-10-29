#!/bin/bash
#
# setup.sh — исполняемый файл для полной настройки проекта в терминале Ubuntu.
#
# Что делает:
#   1. Устанавливает Ollama (если ещё не установлен)
#   2. Запускает сервер Ollama в фоне
#   3. Скачивает модель Gemma 3 (multimodal)
#   4. Устанавливает Python 3 и необходимые зависимости для бэкенда
#   5. Делает run.sh исполняемым
#
# Запуск:  chmod +x setup.sh && ./setup.sh

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo "=================================================="
echo "  Настройка проекта Gemma 3 + веб-интерфейс (Ollama)"
echo "=================================================="

# ---------- 1. Установка Ollama ----------
echo ""
echo "[1/5] Проверка/установка Ollama..."
if command -v ollama >/dev/null 2>&1; then
    echo "   Ollama уже установлен: $(ollama --version)"
else
    echo "   Ollama не найден. Устанавливаю официальный скрипт..."
    curl -fsSL https://ollama.com/install.sh | sh
    echo "   Ollama установлен."
fi

# ---------- 2. Запуск сервера Ollama ----------
echo ""
echo "[2/5] Запуск сервера Ollama в фоне..."
if pgrep -x "ollama" >/dev/null 2>&1; then
    echo "   Ollama сервер уже запущен."
else
    nohup ollama serve > /tmp/ollama.log 2>&1 &
    echo "   ollama serve запущен (PID $!). Логи: /tmp/ollama.log"
    echo "   Ожидание готовности сервера (до 30 сек)..."
    for i in $(seq 1 30); do
        if curl -s http://localhost:11434/api/tags >/dev/null 2>&1; then
            echo "   Сервер Ollama готов."
            break
        fi
        sleep 1
    done
fi

# ---------- 3. Скачивание модели Gemma 3 ----------
echo ""
echo "[3/5] Скачивание модели Gemma 3 (это может занять время)..."
if ollama list 2>/dev/null | grep -q "^gemma3"; then
    echo "   Модель gemma3 уже скачана."
else
    ollama pull gemma3
    echo "   Модель gemma3 скачана."
fi

# ---------- 4. Установка Python и зависимостей ----------
echo ""
echo "[4/5] Установка Python 3 и зависимостей бэкенда..."
if ! command -v python3 >/dev/null 2>&1; then
    echo "   Python3 не найден. Устанавливаю..."
    sudo apt-get update -y
    sudo apt-get install -y python3 python3-pip python3-venv
fi

if ! command -v pip3 >/dev/null 2>&1 && ! python3 -m pip --version >/dev/null 2>&1; then
    echo "   pip3 не найден. Устанавливаю..."
    sudo apt-get install -y python3-pip
fi

python3 -m pip install --upgrade pip
python3 -m pip install -r "$PROJECT_DIR/backend/requirements.txt"
echo "   Зависимости Python установлены."

# ---------- 5. Права на запуск ----------
echo ""
echo "[5/5] Права на исполнение run.sh..."
chmod +x "$PROJECT_DIR/run.sh"
chmod +x "$PROJECT_DIR/setup.sh"

echo ""
echo "=================================================="
echo "  Настройка завершена!"
echo "  Запустите проект:  ./run.sh"
echo "  Веб-интерфейс будет доступен по адресу: http://localhost:5000"
echo "=================================================="