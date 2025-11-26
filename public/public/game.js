let ws;
let username = "";
let timerInterval;

// FIX — convert "10H" → "0H" for deckofcardsapi
function fixCardCode(card) {
  if (card.startsWith("10")) {
    return "0" + card.slice(2);
  }
  return card;
}

function login() {
  username = document.getElementById("username").value.trim();
  if (!username) return alert("Enter a name!");

  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("lobby-screen").classList.remove("hidden");
  document.getElementById("player-name").innerText = username;
}

function joinTable() {
  document.getElementById("lobby-screen").classList.add("hidden");
  document.getElementById("table-screen").classList.remove("hidden");

  ws = new WebSocket("wss://" + window.location.host);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "join", name: username }));
  };

  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);

    if (data.type === "cards") {
      updateCommunityCards(data.cards);
      startTimer(7);
    }
  };
}

function updateCommunityCards(cards) {
  const area = document.getElementById("community-cards");
  area.innerHTML = "";

  cards.forEach(card => {
    let fixed = fixCardCode(card); // FIX APPLIED HERE
    let img = document.createElement("img");
    img.src = `https://deckofcardsapi.com/static/img/${fixed}.png`;
    img.style.width = "80px";
    img.style.margin = "5px";
    area.appendChild(img);
  });
}

function sendAction(action) {
  ws.send(JSON.stringify({ type: "action", action }));
}

function startTimer(seconds) {
  clearInterval(timerInterval);
  let time = seconds;

  document.getElementById("timer").innerText = time;

  timerInterval = setInterval(() => {
    time--;
    document.getElementById("timer").innerText = time;

    if (time <= 0) {
      clearInterval(timerInterval);
      sendAction("fold");
    }
  }, 1000);
}
