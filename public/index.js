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
    if (data?.mode === "answer" && typeof data?.text === "string") {
      const div = document.createElement("div");
      div.className = "message bot";
      div.innerText = data.text;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return;
    }

    const items = Array.isArray(data?.result)
      ? data.result
      : (data?.result?.points || []);

    if (items.length > 0) {
      items.forEach((item) => {
        const payload = item.payload || {};
        const goodsNo = payload.goods_no || item.id || "";
        const link = goodsNo
          ? `https://www.esthermall.co.kr/goods/goods_view.php?goodsNo=${goodsNo}`
          : null;

        const card = document.createElement("div");
        card.className = "message bot";

        const a = document.createElement("a");
        if (link) {
          a.href = link;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
        }
        a.style.display = "flex";
        a.style.gap = "8px";
        a.style.textDecoration = "none";
        a.style.color = "inherit";
        a.style.alignItems = "center";

        const img = document.createElement("img");
        img.src = payload.image_url || "";
        img.alt = payload.name || "상품 이미지";
        img.style.width = "48px";
        img.style.height = "48px";
        img.style.objectFit = "cover";
        img.style.borderRadius = "8px";
        img.loading = "lazy";

        const info = document.createElement("div");
        info.style.flex = "1";
        info.style.minWidth = "0";

        const title = document.createElement("div");
        title.style.fontWeight = "600";
        title.style.whiteSpace = "nowrap";
        title.style.overflow = "hidden";
        title.style.textOverflow = "ellipsis";
        title.innerText = payload.name || "상품명 없음";
        info.appendChild(title);
        a.appendChild(img);
        a.appendChild(info);
        card.appendChild(a);

        const summary = document.createElement("div");
        summary.style.fontSize = "12px";
        summary.style.marginTop = "6px";
        summary.style.opacity = "0.9";
        summary.innerText = payload.effects_summary || "효능 요약 정보 없음";

        card.appendChild(summary);
        messagesEl.appendChild(card);
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
    const sessionId = getSessionId();
    const res = await fetch("/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: text, sessionId }),
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
sendBtn.addEventListener("click", (e) => {
  e.preventDefault();
  sendMessage();
  sendBtn.disabled = true;

  // 응답 중 표시
  const loadingDiv = document.createElement("div");
  loadingDiv.className = "message reply_wait";
  loadingDiv.innerText = "응답 중…";
  messagesEl.appendChild(loadingDiv);
  messagesEl.scrollTop = messagesEl.scrollHeight;
});

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

function getSessionId() {
  const key = "chat_session_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(key, id);
  }
  return id;
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
