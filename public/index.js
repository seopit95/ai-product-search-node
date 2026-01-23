// public/main.js
async function send() {
  const msg = document.getElementById("msg").value;

  const res = await fetch("/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: msg }),
  });

  const data = await res.json();

  document.getElementById("result").textContent = data.reply;
}

// HTML에서 onclick 쓰기 위해 노출
window.send = send;