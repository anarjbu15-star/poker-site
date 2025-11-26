const express = require("express");
const path = require("path");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 10000;

// Serve public folder
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

let users = {};

// -------------------------
// REST API: Register user
// -------------------------
app.post("/register", (req, res) => {
    const { username, password } = req.body;
    if (users[username]) {
        return res.status(400).json({ error: "exists" });
    }
    users[username] = { password, chips: 1000 };
    res.json({ success: true });
});

// -------------------------
// REST API: Login user
// -------------------------
app.post("/login", (req, res) => {
    const { username, password } = req.body;
    if (!users[username] || users[username].password !== password) {
        return res.status(401).json({ error: "invalid" });
    }
    res.json({ success: true, username });
});

// -------------------------
// Start HTTP Server
// -------------------------
const httpServer = app.listen(PORT, () => {
    console.log("Server running on " + PORT);
});

// -------------------------
// WebSocket Server
// -------------------------
const wss = new WebSocket.Server({ server: httpServer });

// Generate one random playing card
function getRandomCard() {
    const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "0", "J", "Q", "K"]; 
    const suits = ["H", "D", "C", "S"];
    return ranks[Math.floor(Math.random() * ranks.length)] +
           suits[Math.floor(Math.random() * suits.length)];
}

// Generate 5 community cards
function getCommunityCards() {
    return [
        getRandomCard(),
        getRandomCard(),
        getRandomCard(),
        getRandomCard(),
        getRandomCard()
    ];
}

// -------------------------
// WS Connection Handling
// -------------------------
wss.on("connection", ws => {
    console.log("WS Connected");

    ws.send(JSON.stringify({ msg: "WS connected" }));

    // Send 5 community cards immediately
    const cards = getCommunityCards();
    ws.send(JSON.stringify({
        type: "cards",
        cards: cards
    }));
});
