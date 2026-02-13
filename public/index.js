const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const initChatDiv = document.createElement("div");
initChatDiv.className = 'message bot';
initChatDiv.innerText = '뭐 찾아줄까?';
messagesEl.appendChild(initChatDiv);
function addMessage(data, sender) {
  const div2 = document.createElement("div");
  if (sender === 'bot') {
    const items = Array.isArray(data?.result)
      ? data.result
      : (data?.result?.points || []);

    if (items.length > 0) {
      items.forEach((item) => {
        const div = document.createElement("div");
        div.className = "message bot";
        div.innerText = "상품명: " + item.payload.name + "\n설명: " + item.payload.description + "\n가격: " + item.payload.price;
        messagesEl.appendChild(div);
      });
    } else {
      const div = document.createElement("div");
      div.className = "message bot";
      div.innerText = "요청주신 정보의 상품은 없습니다.";
      messagesEl.appendChild(div);
    }

    if (data?.usage) {
      div2.innerText = "전체: " + data.usage.total_tokens + " | 요청토큰: " + data.usage.prompt_tokens;
      div2.style.fontSize = '9px';
      messagesEl.appendChild(div2);
    }
  } else {
    const div = document.createElement("div");
    div.className = "message " + sender;
    div.innerText = data;
    messagesEl.appendChild(div);
  }

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) return;

  addMessage(text, "user");
  inputEl.value = "";
  sendBtn.disabled = true;

  try {
    const res = await fetch("/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: text }),
    });
    document.querySelector('.reply_wait').remove();

    const data = await res.json();
    addMessage(data || "응답이 없습니다.", "bot");
  } catch (e) {
    throw new Error("서버와 통신할 수 없습니다.");
  } finally {
    sendBtn.disabled = false;
  }
}

inputEl.addEventListener("keydown", handleEnter);
sendBtn.addEventListener("click", handleEnter);

function handleEnter(e) {
  if (e.isComposing) return;
  if (e.key === "Enter") {
    sendMessage();
    sendBtn.disabled = true;

    // 응답 중 표시
    const loadingDiv = document.createElement("div");
    loadingDiv.className = "message reply_wait";
    loadingDiv.innerText = "응답 중…";
    messagesEl.appendChild(loadingDiv);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}
const toggleBtn = document.getElementById('chatbot-toggle');
const chatbot = document.getElementById('chatbot');
const closeBtn = document.getElementById('closeChat');

// 토글 열기/닫기
toggleBtn.addEventListener('click', (e) => {
  e.stopPropagation(); // 바깥 클릭 방지
  if (chatbot.classList.contains('active')) {
    closeChat();
    return;
  }
  openChat();
});

// 닫기 버튼
closeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  closeChat();
});

// 바깥 클릭 시 닫기
document.addEventListener('click', (e) => {
  if (!chatbot.classList.contains('active')) return;

  // 챗봇 영역 안이면 무시
  if (chatbot.contains(e.target)) return;

  closeChat();
});

function closeChat() {
  chatbot.classList.remove('active');
  setTimeout(() => {
    chatbot.classList.add('hidden');
  }, 250);
}

function openChat() {
  chatbot.classList.remove('hidden');
  requestAnimationFrame(() => {
    chatbot.classList.add('active');
  });
}
