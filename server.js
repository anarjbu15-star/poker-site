const express = require("express");
const path = require("path");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.static(path.join(__dirname, "public")));

const server = app.listen(PORT, () =>
  console.log("HiPoker server running on PORT " + PORT)
);

const wss = new WebSocket.Server({ server });

// Hold connected players
let players = [];

// Send community cards every 7 seconds
function dealCommunityCards() {
  const deck = [
    "AS","KS","QS","JS","TS","9S","8S","7S","6S","5S","4S","3S","2S",
    "AC","KC","QC","JC","TC","9C","8C","7C","6C","5C","4C","3C","2C",
    "AD","KD","QD","JD","TD","9D","8D","7D","6D","5D","4D","3D","2D",
    "AH","KH","QH","JH","TH","9H","8H","7H","6H","5H","4H","3H","2H"
  ];

  const cards = [];
  for (let i = 0; i < 5; i++) {
    const pick = Math.floor(Math.random() * deck.length);
    cards.push(deck.splice(pick, 1)[0]);
  }

  broadcast({ type: "communityCards", cards });
}

// Broadcast to all players
function broadcast(data) {
  const msg = JSON.stringify(data);
  players.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

wss.on("connection", ws => {
  players.push(ws);
  console.log("Player connected:", players.length);

  ws.on("message", msg => {
    let data;
    try { data = JSON.parse(msg); } catch { return; }

    if (data.type === "join") {
      console.log("Player joined:", data.name);
    }

    if (data.type === "action") {
      console.log("Action:", data.action);
    }
  });

  ws.on("close", () => {
    players = players.filter(p => p !== ws);
    console.log("Player left:", players.length);
  });
});

// Deal cards in loop
setInterval(dealCommunityCards, 7000);
