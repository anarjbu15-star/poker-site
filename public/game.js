let ws;
let username = "";
let timerInterval;

function login() {
  username = document.getElementById("username").value.trim();
  if (!username) return alert("Enter a username!");

  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("table-screen").classList.remove("hidden");

  connectWS();
}

function connectWS() {
  ws = new WebSocket("wss://" + window.location.host);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "join", name: username }));
  };

  ws.onmessage = msg => {
    const data = JSON.parse(msg.data);

    if (data.type === "communityCards") {
      updateCommunityCards(data.cards);
      startTimer(7);
    }
  };
}

function updateCommunityCards(cards) {
  const area = document.getElementById("community-cards");
  area.innerHTML = "";

  cards.forEach(card => {
    const img = document.createElement("img");
    img.className = "card-img";
    img.src = `https://deckofcardsapi.com/static/img/${card}.png`;
    area.appendChild(img);
  });
}

function sendAction(action) {
  ws.send(JSON.stringify({ type: "action", action }));
}

function startTimer(seconds) {
  clearInterval(timerInterval);
  let t = seconds;

  document.getElementById("timer").innerText = t;

  timerInterval = setInterval(() => {
    t--;
    document.getElementById("timer").innerText = t;

    if (t <= 0) {
      clearInterval(timerInterval);
      sendAction("fold");
    }
  }, 1000);
}
