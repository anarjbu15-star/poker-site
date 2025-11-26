let ws;
let username = "";
let timerInterval;

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

  // Render needs wss:// + host
  const wsURL = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
  ws = new WebSocket(wsURL);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "join", name: username }));
  };

  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);

    if (data.type === "cards") {
      updateCommunityCards(data.cards);
    }

    if (data.type === "hole") {
      updateHoleCards(data.cards);
    }

    if (data.type === "timer") {
      startTimer(data.seconds);
    }
  };
}

// Show community cards
function updateCommunityCards(cards) {
  const area = document.getElementById("community-cards");
  area.innerHTML = "";

  cards.forEach(card => {
    let img = document.createElement("img");
    img.src = `https://deckofcardsapi.com/static/img/${card}.png`;
    img.className = "card-img";
    area.appendChild(img);
  });
}

// Show player hand (your two cards)
function updateHoleCards(cards) {
  const area = document.getElementById("player-cards");
  area.innerHTML = "";

  cards.forEach(card => {
    let img = document.createElement("img");
    img.src = `https://deckofcardsapi.com/static/img/${card}.png`;
    img.className = "card-img";
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
