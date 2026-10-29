/*
 * script.js — клиентская логика веб-интерфейса Gemma 3 Chat.
 * Поддержка: несколько сессий, отправка текста + изображений, потоковый ответ от Ollama.
 */

const API_BASE = "/api";
const UPLOAD_BASE = "/uploads";

let currentSessionId = null;
let sessions = [];
let pendingFiles = [];          // файлы, готовые к отправке: {file, url, name}
let currentAbortController = null;
let typingTimer = null;

// ---------- DOM элементы ----------
const els = {
    sidebar: document.querySelector(".sidebar"),
    sidebarToggle: document.getElementById("sidebar-toggle"),
    newChatBtn: document.getElementById("new-chat-btn"),
    sessionsList: document.getElementById("sessions-list"),
    sessionSearch: document.getElementById("session-search"),
    emptyState: document.getElementById("empty-state"),
    messagesArea: document.getElementById("messages-area"),
    sessionTitle: document.getElementById("session-title"),
    sessionSubtitle: document.getElementById("session-subtitle"),
    deleteSessionBtn: document.getElementById("delete-session-btn"),
    chatForm: document.getElementById("chat-form"),
    messageInput: document.getElementById("message-input"),
    attachBtn: document.getElementById("attach-btn"),
    fileInput: document.getElementById("file-input"),
    previewArea: document.getElementById("preview-area"),
    sendBtn: document.getElementById("send-btn"),
    charCount: document.getElementById("char-count"),
};

// ---------- Инициализация ----------
async function init() {
    await loadSessions();
    renderSessionsList();

    if (sessions.length > 0) {
        await loadSession(sessions[0].id);
    } else {
        showEmptyState();
    }

    // Обработчики
    els.newChatBtn.addEventListener("click", createNewSession);
    els.sidebarToggle.addEventListener("click", toggleSidebar);
    els.sessionSearch.addEventListener("input", renderSessionsList);
    els.chatForm.addEventListener("submit", handleSubmit);
    els.attachBtn.addEventListener("click", () => els.fileInput.click());
    els.fileInput.addEventListener("change", handleFileSelect);
    els.messageInput.addEventListener("input", () => {
        autoResize(els.messageInput);
        updateSendButton();
        els.charCount.textContent = els.messageInput.value.length;
    });
    els.messageInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            els.chatForm.dispatchEvent(new Event("submit"));
        }
    });
    els.deleteSessionBtn.addEventListener("click", deleteCurrentSession);

    // Закрыть сайдбар по клику вне его (мобильные)
    document.addEventListener("click", (e) => {
        if (window.innerWidth > 768) return;
        if (!els.sidebar.contains(e.target) && !els.sidebarToggle.contains(e.target)) {
            els.sidebar.classList.remove("open");
        }
    });
}

// ---------- Сессии ----------

async function loadSessions() {
    try {
        const res = await fetch(`${API_BASE}/sessions`);
        sessions = await res.json();
    } catch (e) {
        console.error("Не удалось загрузить сессии:", e);
        sessions = [];
    }
}

function renderSessionsList() {
    const query = els.sessionSearch.value.toLowerCase();
    els.sessionsList.innerHTML = "";

    const filtered = sessions.filter((s) =>
        s.title.toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
        els.sessionsList.innerHTML = '<div class="empty-sessions">Ничего не найдено</div>';
        return;
    }

    filtered.forEach((s) => {
        const item = document.createElement("div");
        item.className = `session-item ${s.id === currentSessionId ? "active" : ""}`;
        item.innerHTML = `
            <div class="icon">💬</div>
            <div class="info">
                <div class="title">${escapeHtml(s.title)}</div>
                <div class="subtitle">${s.message_count} сообщений</div>
            </div>
        `;
        item.addEventListener("click", () => loadSession(s.id));
        els.sessionsList.appendChild(item);
    });

    // Подсветка активной
    document.querySelectorAll(".session-item").forEach((el) => {
        const id = el.getAttribute("data-id");
        if (id === currentSessionId) el.classList.add("active");
    });
}

async function loadSession(id) {
    currentSessionId = id;
    els.deleteSessionBtn.style.display = "flex";

    try {
        const res = await fetch(`${API_BASE}/sessions/${id}`);
        const data = await res.json();

        els.sessionTitle.textContent = data.title || "Новый чат";
        els.sessionSubtitle.textContent = `${data.messages.length} сообщений`;
        renderMessages(data.messages);
        showMessagesArea();
    } catch (e) {
        console.error("Не удалось загрузить сессию:", e);
    }

    renderSessionsList();
    els.sidebar.classList.remove("open");
}

async function createNewSession() {
    try {
        const res = await fetch(`${API_BASE}/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "Новый чат" }),
        });
        const data = await res.json();
        sessions.unshift(data);
        renderSessionsList();
        await loadSession(data.id);
    } catch (e) {
        console.error("Не удалось создать сессию:", e);
        alert("Ошибка создания сессии");
    }
}

async function deleteCurrentSession() {
    if (!currentSessionId) return;
    if (!confirm("Удалить этот чат?")) return;

    try {
        await fetch(`${API_BASE}/sessions/${currentSessionId}`, { method: "DELETE" });
        sessions = sessions.filter((s) => s.id !== currentSessionId);
        currentSessionId = null;
        renderSessionsList();
        if (sessions.length > 0) {
            await loadSession(sessions[0].id);
        } else {
            showEmptyState();
        }
    } catch (e) {
        console.error("Не удалось удалить сессию:", e);
        alert("Ошибка удаления сессии");
    }
}

// ---------- Сообщения ----------

function renderMessages(messages) {
    els.messagesArea.innerHTML = "";

    messages.forEach((msg) => {
        appendMessage(msg.role, msg.content, msg.images || [], msg.timestamp);
    });

    scrollToBottom();
}

function appendMessage(role, content, images = [], timestamp) {
    const wrapper = document.createElement("div");
    wrapper.className = `message ${role}`;

    const avatar = role === "user" ? "👤" : "🤖";
    let imagesHtml = "";
    if (images && images.length) {
        imagesHtml = '<div class="msg-images">' +
            images.map((img) => {
                const url = img.startsWith("http") ? img : `${UPLOAD_BASE}/${img}`;
                return `<img src="${url}" alt="изображение" onclick="openImage('${escapeAttr(url)}')">`;
            }).join("") +
            "</div>";
    }

    const timeHtml = timestamp
        ? `<span class="meta">${formatTime(timestamp)}</span>`
        : "";

    wrapper.innerHTML = `
        <div class="avatar">${avatar}</div>
        <div class="content">
            ${formatContent(content)}
            ${imagesHtml}
            ${timeHtml}
        </div>
    `;

    els.messagesArea.appendChild(wrapper);
    scrollToBottom();
    return wrapper;
}

function appendAssistantStreaming() {
    const wrapper = document.createElement("div");
    wrapper.className = "message assistant";
    wrapper.innerHTML = `
        <div class="avatar">🤖</div>
        <div class="content">
            <div class="streaming-text"></div>
            <span class="typing-indicator"><span>┈</span><span>┈</span><span>┈</span></span>
        </div>
    `;
    els.messagesArea.appendChild(wrapper);
    scrollToBottom();
    return wrapper.querySelector(".streaming-text");
}

function updateLastAssistantMessage(text) {
    // Находим последнее сообщение ассистента и обновляем его текст
    const messages = els.messagesArea.querySelectorAll(".message.assistant");
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    const contentDiv = last.querySelector(".content");
    const streamingDiv = last.querySelector(".streaming-text");
    const typing = last.querySelector(".typing-indicator");

    if (streamingDiv) {
        streamingDiv.textContent = text;
        if (typing) typing.remove();
        scrollToBottom();
    }
}

function finishAssistantMessage(fullText) {
    // Заменяем стриминг-див на полноценное сообщение
    const messages = els.messagesArea.querySelectorAll(".message.assistant");
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    last.querySelector(".streaming-text").remove();
    const typing = last.querySelector(".typing-indicator");
    if (typing) typing.remove();

    const contentDiv = last.querySelector(".content");
    contentDiv.innerHTML = formatContent(fullText);
    scrollToBottom();
}

// ---------- Отправка сообщения ----------

async function handleSubmit(e) {
    e.preventDefault();

    if (!currentSessionId) {
        await createNewSession();
        if (!currentSessionId) return;
    }

    const text = els.messageInput.value.trim();
    if (!text && pendingFiles.length === 0) return;

    // Отменяем предыдущий запрос, если есть
    if (currentAbortController) currentAbortController.abort();

    // Добавляем сообщение пользователя
    appendMessage("user", text, pendingFiles.map((f) => f.name));
    els.messageInput.value = "";
    autoResize(els.messageInput);
    updateSendButton();
    els.charCount.textContent = "0";
    clearPreviews();

    const filesToSend = [...pendingFiles];
    pendingFiles = [];

    // Начинаем потоковый ответ ассистента
    const streamingTextEl = appendAssistantStreaming();

    const formData = new FormData();
    formData.append("message", text);
    filesToSend.forEach((f) => formData.append("images", f.file));

    currentAbortController = new AbortController();

    try {
        const res = await fetch(`${API_BASE}/sessions/${currentSessionId}/msg`, {
            method: "POST",
            body: formData,
            signal: currentAbortController.signal,
        });

        if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let fullReply = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // Разбиваем по SSE границам "\n\n"
            const parts = buffer.split("\n\n");
            buffer = parts.pop(); // последняя неполная часть остаётся в буфере

            for (const part of parts) {
                const line = part.trim();
                if (!line.startsWith("data: ")) continue;
                const payload = line.slice(6);
                try {
                    const data = JSON.parse(payload);
                    if (data.type === "token") {
                        fullReply += data.content;
                        updateLastAssistantMessage(fullReply);
                    } else if (data.type === "error") {
                        updateLastAssistantMessage(fullReply + `\n\n[Ошибка: ${escapeHtml(data.error)}]`);
                    }
                } catch (err) {
                    // игнорируем битые JSON-чанки
                }
            }
        }

        finishAssistantMessage(fullReply);
        currentAbortController = null;

        // Обновим список сессий (счётчик сообщений и заголовок)
        await loadSessions();
        renderSessionsList();
        if (els.sessionTitle) {
            const s = sessions.find((x) => x.id === currentSessionId);
            if (s) els.sessionTitle.textContent = s.title;
        }
    } catch (err) {
        if (err.name === "AbortError") {
            updateLastAssistantMessage((streamingTextEl.textContent || "") + "\n\n[Прервано]");
        } else {
            updateLastAssistantMessage((streamingTextEl.textContent || "") + `\n\n[Ошибка: ${escapeHtml(err.message)}]`);
        }
        currentAbortController = null;
    }
}

// ---------- Изображения ----------

function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        const url = URL.createObjectURL(file);
        pendingFiles.push({ file, url, name: file.name });
    }

    renderPreviews();
    updateSendButton();
    els.fileInput.value = ""; // сброс, чтобы можно было выбрать тот же файл повторно
}

function renderPreviews() {
    els.previewArea.innerHTML = "";
    pendingFiles.forEach((pf, idx) => {
        const item = document.createElement("div");
        item.className = "preview-item";
        item.innerHTML = `
            <img src="${pf.url}" alt="предпросмотр">
            <div class="remove" onclick="removePreview(${idx})">×</div>
        `;
        els.previewArea.appendChild(item);
    });
}

function clearPreviews() {
    pendingFiles = [];
    els.previewArea.innerHTML = "";
}

window.removePreview = function (idx) {
    pendingFiles.splice(idx, 1);
    renderPreviews();
    updateSendButton();
};

function openImage(url) {
    const win = window.open(url, "_blank");
    if (!win) alert("Не удалось открыть изображение");
}

// ---------- Вспомогательные ----------

function updateSendButton() {
    const hasText = els.messageInput.value.trim().length > 0;
    const hasFiles = pendingFiles.length > 0;
    els.sendBtn.disabled = !(hasText || hasFiles);
}

function autoResize(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

function formatContent(text) {
    if (!text) return "";
    // Простой рендер: переносы строк, жирный, код-блоки
    let html = escapeHtml(text);
    html = html.replace(/\n/g, "<br>");
    // код-блоки ``` ... ```
    html = html.replace(
        /<br>&lt;&lt;&lt;<br>([\s\S]*?)&lt;&lt;&lt;<br>/g,
        (m, code) => `<pre><code>${escapeHtml(code.trim())}</code></pre>`
    );
    // инлайн код `...`
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    // ссылки
    html = html.replace(
        /(https?:\/\/[^\s<]+)/g,
        '<a href="$1" target="_blank" rel="noopener">$1</a>'
    );
    return html;
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function escapeAttr(str) {
    return str.replace(/"/g, "&quot;");
}

function formatTime(iso) {
    try {
        const d = new Date(iso);
        const now = new Date();
        if (d.toDateString() === now.toDateString()) {
            return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        }
        return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
    } catch (e) {
        return iso;
    }
}

function showEmptyState() {
    els.emptyState.style.display = "flex";
    els.messagesArea.style.display = "none";
    els.sessionTitle.textContent = "Выберите чат";
    els.sessionSubtitle.textContent = "Gemma 3 через Ollama";
    els.deleteSessionBtn.style.display = "none";
    currentSessionId = null;
}

function showMessagesArea() {
    els.emptyState.style.display = "none";
    els.messagesArea.style.display = "flex";
}

function scrollToBottom() {
    els.messagesArea.scrollTop = els.messagesArea.scrollHeight;
}

function toggleSidebar() {
    els.sidebar.classList.toggle("open");
}

// ---------- Старт ----------
init();
