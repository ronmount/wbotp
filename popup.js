let intervalId = null;

async function getStoredToken() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['wbToken'], (result) => {
            resolve(result.wbToken);
        });
    });
}

async function storeToken(token) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ wbToken: token }, resolve);
    });
}

async function getTokenFromWB() {
    // Создаем новую вкладку
    const tab = await chrome.tabs.create({
        url: 'https://www.wildberries.ru',
        active: false // вкладка создается в фоне
    });

    // Ждем загрузки страницы
    await new Promise(resolve => {
        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (tabId === tab.id && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        });
    });

    // Выполняем скрипт для получения токена
    try {
        const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                const tokenData = localStorage.getItem('wbx__tokenData');
                return tokenData;
            }
        });

        // Закрываем вкладку
        chrome.tabs.remove(tab.id);

        if (result) {
            const { token } = JSON.parse(result);
            await storeToken(token);
            return token;
        }
    } catch (e) {
        console.error('Error executing script:', e);
        chrome.tabs.remove(tab.id);
    }

    return null;
}

let isTokenRequestFailed = false; // Флаг неудачной попытки получения токена

async function getToken() {
    // Если уже была неудачная попытка, не пытаемся снова
    if (isTokenRequestFailed) {
        return null;
    }

    // Сначала пробуем получить сохраненный токен
    let token = await getStoredToken();

    // Если токена нет, пробуем получить новый
    if (!token) {
        token = await getTokenFromWB();
        // Если не удалось получить токен, устанавливаем флаг
        if (!token) {
            isTokenRequestFailed = true;
            // Останавливаем polling при неудаче получения токена
            stopPolling();
        }
    }

    return token;
}

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        console.error('Failed to copy text: ', err);
        return false;
    }
}

// Функция для форматирования времени из наносекунд
function formatTime(nanoTimestamp) {
    // Конвертируем наносекунды в миллисекунды
    const milliseconds = Math.floor(nanoTimestamp / 1000000);
    const date = new Date(milliseconds);

    // Форматируем время в 24-часовом формате
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');

    return `${hours}:${minutes}`;
}

let copiedCodes = new Map(); // Хранилище состояний копирования для каждого кода

function createCodeElement(code, timestamp) {
    const isCopied = copiedCodes.get(code);
    return `
    <div class="code-container">
      <div class="code-info">
        <div class="code">${code}</div>
        <div class="time">${formatTime(timestamp)}</div>
      </div>
      <button class="copy-button ${isCopied ? 'copied' : ''}" data-code="${code}">
        ${isCopied ? 'Скопировано!' : 'Копировать'}
      </button>
    </div>
  `;
}

async function fetchNotifications() {
    const token = await getToken();
    if (!token) {
        document.getElementById('codes').innerHTML = '<div class="message">Требуется авторизация на wildberries.ru</div>';
        return;
    }

    try {
        const response = await fetch('https://wbx-bell-v3.wildberries.ru/shard-proxy/api/v3/notice/get?app_type=web', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });

        const data = await response.json();

        // Проверяем наличие ошибки в ответе
        if (data.result !== 0) {
            console.error('API Error:', data);
            // Если ошибка связана с JWT, сбрасываем токен и пробуем получить новый
            if (data.error === 'JWT is invalid') {
                await storeToken(null);
                fetchNotifications();
                return;
            }
            document.getElementById('codes').innerHTML = '<div class="message error">Ошибка при получении данных<br>Попробуйте позже</div>';
            return;
        }

        if (data.payload) {
            const codesWithTime = [];
            data.payload.forEach(notification => {
                const match = notification.text.match(/\b\d{6}\b/);
                if (match) {
                    codesWithTime.push({
                        code: match[0],
                        timestamp: notification.dt
                    });
                }
            });

            codesWithTime.sort((a, b) => b.timestamp - a.timestamp);

            if (codesWithTime.length > 0) {
                const htmlContent = codesWithTime
                    .map(item => createCodeElement(item.code, item.timestamp))
                    .join('');
                document.getElementById('codes').innerHTML = htmlContent;

                document.querySelectorAll('.copy-button').forEach(button => {
                    button.addEventListener('click', async () => {
                        const code = button.dataset.code;
                        const success = await copyToClipboard(code);

                        if (success) {
                            button.textContent = 'Скопировано!';
                            button.classList.add('copied');
                            copiedCodes.set(code, true);

                            setTimeout(() => {
                                button.textContent = 'Копировать';
                                button.classList.remove('copied');
                                copiedCodes.delete(code);
                            }, 2000);
                        }
                    });
                });
            } else {
                document.getElementById('codes').innerHTML = '<div class="message">Нет активных кодов</div>';
            }
        }
    } catch (error) {
        console.error('Fetch error:', error);
        document.getElementById('codes').innerHTML = '<div class="message error">Ошибка при получении данных<br>Попробуйте позже</div>';
    }
}

function startPolling() {
    // Сбрасываем флаг при старте polling
    isTokenRequestFailed = false;
    fetchNotifications();
    intervalId = setInterval(fetchNotifications, 1000);
}

function stopPolling() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
}

document.addEventListener('DOMContentLoaded', startPolling);
window.addEventListener('unload', stopPolling);