// server.js
const express = require("express");
const path = require("path");
const WebSocket = require("ws");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
const PORT = process.env.PORT || 10000;

const http = app.listen(PORT, () => console.log("Server on " + PORT));
const wss = new WebSocket.Server({ server: http });

// ---- Utility: Deck & hand evaluation ----
const RANKS = ["2","3","4","5","6","7","8","9","0","J","Q","K","A"]; // "0" is 10
const SUITS = ["H","D","C","S"];
function newDeck(){
  const d=[];
  for(const r of RANKS) for(const s of SUITS) d.push(r+s);
  return d;
}
function shuffle(deck){
  for(let i=deck.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [deck[i],deck[j]]=[deck[j],deck[i]];
  }
}

// Evaluate best 5-card hand from up to 7 cards
// Returns [rankCategory (0..9), tie-breaker array ...] where bigger is better.
// Categories (low->high): High Card 0, Pair 1, Two Pair 2, Trips 3, Straight 4, Flush 5, Full House 6, Quads 7, Straight Flush 8, Royal Flush 9
function cardValue(card){
  const r = card[0];
  return RANKS.indexOf(r);
}
function countByRank(cards){
  const m = {};
  for(const c of cards){ const r=c[0]; m[r] = (m[r]||0)+1; }
  return m;
}
function countBySuit(cards){
  const m = {};
  for(const c of cards){ const s=c[1]; m[s] = (m[s]||0)+1; }
  return m;
}
function uniqueRanksSortedDesc(cards){
  const set = new Set(cards.map(c=>c[0]));
  const arr = Array.from(set);
  arr.sort((a,b)=>RANKS.indexOf(b)-RANKS.indexOf(a));
  return arr;
}
function isStraightFromRanksSorted(arr){ // arr is unique ranks sorted desc by value
  // convert to indexes
  const idx = arr.map(r=>RANKS.indexOf(r));
  // also consider wheel A-2-3-4-5 (A treated as low)
  // slide window length 5
  for(let i=0;i<=idx.length-5;i++){
    let ok=true;
    for(let k=0;k<4;k++){
      if(idx[i+k] !== idx[i+k+1]+1){ ok=false; break; }
    }
    if(ok) return RANKS.indexOf(arr[i]); // high card rank index of straight
  }
  // check wheel (A,5,4,3,2)
  const needed = new Set(["A","2","3","4","5"]);
  const has = arr.filter(x=>needed.has(x));
  if(has.length===5) return RANKS.indexOf("5");
  return -1;
}
function bestFiveHandScore(cards){ // cards: array of 5 strings
  // returns comparable array: [category, ...tiebreakers as numeric indices]
  // We'll compute all ranks/suits structures
  const rankCounts = countByRank(cards); // { 'A':2, ...}
  const suitCounts = countBySuit(cards);
  // check flush
  let flushSuit = null;
  for(const s of Object.keys(suitCounts)) if(suitCounts[s]===5) flushSuit=s;
  // ranks unique sorted desc
  const uni = uniqueRanksSortedDesc(cards);
  // check straight
  const straightHighIdx = isStraightFromRanksSorted(uni);
  const isStraight = straightHighIdx!==-1;
  // Straight flush?
  if(flushSuit){
    // get flush cards
    const flushCards = cards.filter(c=>c[1]===flushSuit);
    const uniFlush = uniqueRanksSortedDesc(flushCards);
    const sfHighIdx = isStraightFromRanksSorted(uniFlush);
    if(sfHighIdx!==-1){
      return [8, sfHighIdx]; // Straight Flush; Royal will be when sfHighIdx == index of A
    }
  }
  // Counts: find quads/trips/pairs
  const counts = Object.values(rankCounts).sort((a,b)=>b-a);
  if(counts[0]===4){
    // quads
    const quadRank = Object.keys(rankCounts).find(r=>rankCounts[r]===4);
    const kicker = uniqueRanksSortedDesc(cards).find(r=>r!==quadRank);
    return [7, RANKS.indexOf(quadRank), RANKS.indexOf(kicker)];
  }
  if(counts[0]===3 && counts[1]===2){
    // full house
    const tripRank = Object.keys(rankCounts).find(r=>rankCounts[r]===3);
    const pairRank = Object.keys(rankCounts).find(r=>rankCounts[r]===2);
    return [6, RANKS.indexOf(tripRank), RANKS.indexOf(pairRank)];
  }
  if(flushSuit){
    // flush: tiebreakers are descending ranks of flush cards
    const flushCards = cards.filter(c=>c[1]===flushSuit).map(c=>c[0]);
    flushCards.sort((a,b)=>RANKS.indexOf(b)-RANKS.indexOf(a));
    return [5, ...flushCards.map(r=>RANKS.indexOf(r))];
  }
  if(isStraight){
    return [4, straightHighIdx];
  }
  if(counts[0]===3){
    const tripRank = Object.keys(rankCounts).find(r=>rankCounts[r]===3);
    const kickers = uniqueRanksSortedDesc(cards).filter(r=>r!==tripRank).slice(0,2);
    return [3, RANKS.indexOf(tripRank), ...kickers.map(r=>RANKS.indexOf(r))];
  }
  if(counts[0]===2 && counts[1]===2){
    // two pair
    const pairs = Object.keys(rankCounts).filter(r=>rankCounts[r]===2).sort((a,b)=>RANKS.indexOf(b)-RANKS.indexOf(a));
    const kicker = uniqueRanksSortedDesc(cards).find(r=>r!==pairs[0] && r!==pairs[1]);
    return [2, RANKS.indexOf(pairs[0]), RANKS.indexOf(pairs[1]), RANKS.indexOf(kicker)];
  }
  if(counts[0]===2){
    const pairRank = Object.keys(rankCounts).find(r=>rankCounts[r]===2);
    const kickers = uniqueRanksSortedDesc(cards).filter(r=>r!==pairRank).slice(0,3);
    return [1, RANKS.indexOf(pairRank), ...kickers.map(r=>RANKS.indexOf(r))];
  }
  // High card
  const top = uniqueRanksSortedDesc(cards).slice(0,5);
  return [0, ...top.map(r=>RANKS.indexOf(r))];
}

// compare two score arrays lexicographically
function compareScores(a,b){
  for(let i=0;i<Math.max(a.length,b.length);i++){
    const va = a[i]||0, vb = b[i]||0;
    if(va>vb) return 1;
    if(va<vb) return -1;
  }
  return 0;
}

// best hand from up to 7 cards: return best score
function bestHandFromCards(allCards){
  // choose all 5-card combos (C(n,5))
  const n = allCards.length;
  let best = null;
  const idx = [];
  function comb(start, k){
    if(k===0){
      const chosen = idx.map(i=>allCards[i]);
      const score = bestFiveHandScore(chosen);
      if(!best || compareScores(score,best)>0) best = score;
      return;
    }
    for(let i=start;i<=n-k;i++){
      idx.push(i);
      comb(i+1,k-1);
      idx.pop();
    }
  }
  comb(0,5);
  return best;
}

// ---- Game engine ----
const MAX_SEATS = 6;
const ACTION_TIMEOUT = 7000; // ms

function newEmptyTable(){
  return {
    seats: Array(MAX_SEATS).fill(null).map(()=>({ username:null, ws:null, chips:1000, inHand:false, folded:false, bet:0, hole:[] })),
    deck: [],
    community: [],
    pot: 0,
    minBet: 10,
    dealerPos: -1,
    currentPos: -1,
    round: "idle", // idle, preflop, flop, turn, river, showdown
    toAct: null,
    lastRaise: 0,
    timer: null
  };
}

const table = newEmptyTable();

// Helpers
function broadcastPublic(){
  // Build public view
  const pub = {
    type: "table",
    seats: table.seats.map(s=>{
      if(!s.username) return null;
      return {
        username: s.username,
        chips: s.chips,
        inHand: s.inHand,
        folded: s.folded,
        bet: s.bet
      };
    }),
    community: table.community,
    pot: table.pot,
    minBet: table.minBet,
    round: table.round,
    currentPos: table.currentPos,
    dealerPos: table.dealerPos
  };
  for(const s of table.seats){
    if(s && s.ws && s.ws.readyState===WebSocket.OPEN){
      s.ws.send(JSON.stringify(pub));
    }
  }
}
function sendToSeat(pos,msg){
  const s = table.seats[pos];
  if(s && s.ws && s.ws.readyState===WebSocket.OPEN){
    s.ws.send(JSON.stringify(msg));
  }
}
function broadcast(msg){
  for(const s of table.seats) if(s && s.ws && s.ws.readyState===WebSocket.OPEN) s.ws.send(JSON.stringify(msg));
}

// Seat management
function findSeatByName(username){
  return table.seats.findIndex(s => s.username === username);
}
function assignSeat(username, ws){
  // if already seated, update ws
  let idx = findSeatByName(username);
  if(idx!==-1){ table.seats[idx].ws = ws; return idx; }
  // find first empty
  idx = table.seats.findIndex(s => !s.username);
  if(idx===-1) return -1;
  table.seats[idx].username = username;
  table.seats[idx].ws = ws;
  table.seats[idx].chips = table.seats[idx].chips || 1000;
  return idx;
}

// Game flow
function startHandIfPossible(){
  // need at least 2 players with chips
  const seated = table.seats.filter(s=>s.username && s.chips>0).length;
  if(seated < 2) return;
  // start new hand
  table.deck = newDeck();
  shuffle(table.deck);
  table.community = [];
  table.pot = 0;
  table.round = "preflop";
  table.lastRaise = table.minBet;
  // set dealer: rotate
  table.dealerPos = (table.dealerPos+1) % MAX_SEATS;
  // mark players inHand, clear bets, deal hole cards to those with username & chips
  for(let i=0;i<MAX_SEATS;i++){
    const s = table.seats[i];
    if(s && s.username && s.chips>0){
      s.inHand = true;
      s.folded = false;
      s.bet = 0;
      s.hole = [ table.deck.pop(), table.deck.pop() ];
      // send private hole
      if(s.ws && s.ws.readyState===WebSocket.OPEN){
        s.ws.send(JSON.stringify({ type:"hole", cards: s.hole }));
      }
    } else if(s){
      s.inHand = false; s.folded = true; s.bet = 0; s.hole = [];
    }
  }
  // post blinds: small = next after dealer, big = next
  const smallPos = nextActive(table.dealerPos);
  const bigPos = nextActive(smallPos);
  const smallAmt = Math.min(Math.floor(table.minBet/2), table.seats[smallPos].chips);
  const bigAmt = Math.min(table.minBet, table.seats[bigPos].chips);
  table.seats[smallPos].chips -= smallAmt; table.seats[smallPos].bet = smallAmt; table.pot += smallAmt;
  table.seats[bigPos].chips -= bigAmt; table.seats[bigPos].bet = bigAmt; table.pot += bigAmt;
  table.lastRaise = bigAmt;
  // current to act = next active after big
  table.currentPos = nextActive(bigPos);
  broadcastPublic();
  startActionTimer();
  notifyTurn();
}

function nextActive(pos){
  // returns next seat index after pos that has username and chips>0 and is inHand
  for(let i=1;i<=MAX_SEATS;i++){
    const idx = (pos + i) % MAX_SEATS;
    const s = table.seats[idx];
    if(s && s.username && s.inHand && !s.folded && (s.chips>0 || s.bet>0)) return idx;
  }
  return -1;
}
function remainingActivePlayers(){
  return table.seats.filter(s=>s && s.username && s.inHand && !s.folded).length;
}

function startActionTimer(){
  clearActionTimer();
  let timeLeft = ACTION_TIMEOUT;
  table.timer = setInterval(()=>{
    timeLeft -= 1000;
    // send turn update
    broadcast({ type:"turn", pos: table.currentPos, timeLeft: Math.max(0, Math.ceil(timeLeft/1000)) });
    if(timeLeft <= 0){
      clearActionTimer();
      // auto-fold
      handleAction(table.currentPos, "fold");
    }
  },1000);
}

function clearActionTimer(){
  if(table.timer){ clearInterval(table.timer); table.timer=null; }
}

function notifyTurn(){
  // notify clients whose turn it is (so frontend can enable UI)
  broadcast({ type:"turn", pos: table.currentPos, timeLeft: ACTION_TIMEOUT/1000 });
}

// move to next round or handle end
function advanceRoundIfNeeded(){
  // If only one active player left, end hand
  const active = table.seats.filter(s=>s && s.username && s.inHand && !s.folded);
  if(active.length===1){
    // award pot to that player
    const winnerIdx = table.seats.findIndex(s=>s && s.username && s.inHand && !s.folded);
    table.seats[winnerIdx].chips += table.pot;
    broadcast({ type:"msg", text: `${table.seats[winnerIdx].username} wins pot ${table.pot}` });
    table.pot = 0;
    // end hand
    table.round = "idle";
    broadcastPublic();
    setTimeout(()=>startHandIfPossible(), 2000);
    return;
  }
  // Check if betting is completed for this round: everyone matched lastRaise or is all-in
  const maxBet = Math.max(...table.seats.map(s=>s ? s.bet : 0));
  const unsettled = table.seats.some(s => s && s.username && s.inHand && !s.folded && s.bet !== maxBet && s.chips>0);
  if(unsettled){
    // continue betting
    return;
  }
  // Move to next phase
  if(table.round === "preflop"){
    // burn 1, deal 3
    // (we don't implement burn explicitly, just pop)
    table.community.push(table.deck.pop());
    table.community.push(table.deck.pop());
    table.community.push(table.deck.pop());
    table.round = "flop";
  } else if(table.round === "flop"){
    table.community.push(table.deck.pop());
    table.round = "turn";
  } else if(table.round === "turn"){
    table.community.push(table.deck.pop());
    table.round = "river";
  } else if(table.round === "river"){
    // showdown
    table.round = "showdown";
    resolveShowdown();
    return;
  }
  // reset bets to zero into pot and keep players in hand
  const collected = table.seats.reduce((acc,s)=>{
    if(s && s.bet){ acc += s.bet; s.bet = 0; }
    return acc;
  },0);
  table.pot += collected;
  // lastRaise back to minBet
  table.lastRaise = table.minBet;
  // next to act is next active after dealer
  table.currentPos = nextActive(table.dealerPos);
  broadcastPublic();
  startActionTimer();
  notifyTurn();
}

function resolveShowdown(){
  // collect bets into pot
  const collected = table.seats.reduce((acc,s)=>{
    if(s && s.bet){ acc += s.bet; s.bet = 0; }
    return acc;
  },0);
  table.pot += collected;
  // evaluate best hands among players still in hand (not folded)
  const contenders = table.seats.map((s,idx)=> ({ s, idx })).filter(x=>x.s && x.s.username && x.s.inHand && !x.s.folded);
  const scores = contenders.map(c=> {
    const all = [...c.s.hole, ...table.community];
    return { idx: c.idx, score: bestHandFromCards(all) };
  });
  // find best score
  let best = null;
  let winners = [];
  for(const sc of scores){
    if(!best || compareScores(sc.score,best.score) > 0){
      best = sc;
      winners = [sc.idx];
    } else if(compareScores(sc.score,best.score) === 0){
      winners.push(sc.idx);
    }
  }
  // split pot equally (simple main pot only)
  const portion = Math.floor(table.pot / winners.length);
  for(const w of winners) table.seats[w].chips += portion;
  broadcast({ type:"msg", text: `Showdown winners: ${winners.map(i=>table.seats[i].username).join(", ")}, pot split ${portion}` });
  table.pot = 0;
  table.round = "idle";
  broadcastPublic();
  setTimeout(()=>startHandIfPossible(), 3000);
}

// Handle an action from seat pos
function handleAction(pos, action, amount){
  const seat = table.seats[pos];
  if(!seat || !seat.username || !seat.inHand || seat.folded) return;
  clearActionTimer();
  if(action === "fold"){
    seat.folded = true;
    seat.inHand = false;
    broadcast({ type:"msg", text: `${seat.username} folds` });
  } else if(action === "check"){
    broadcast({ type:"msg", text: `${seat.username} checks` });
    // nothing else
  } else if(action === "call"){
    // match current max bet
    const maxBet = Math.max(...table.seats.map(s=>s ? s.bet : 0));
    const need = maxBet - seat.bet;
    const take = Math.min(need, seat.chips);
    seat.chips -= take;
    seat.bet += take;
    table.pot += 0; // will be collected later
    broadcast({ type:"msg", text: `${seat.username} calls ${take}` });
  } else if(action === "bet" || action === "raise"){
    const toPut = Math.min(amount || table.minBet, seat.chips);
    seat.chips -= toPut;
    seat.bet += toPut;
    table.lastRaise = seat.bet;
    broadcast({ type:"msg", text: `${seat.username} bets/raises ${toPut}` });
  }
  // advance currentPos
  table.currentPos = nextActive(pos);
  broadcastPublic();
  // if only one player left - showdown
  if(remainingActivePlayers() <= 1){
    advanceRoundIfNeeded();
    return;
  }
  // continue betting round: check if settled else start timer
  // settle: everyone matched highest bet or is all-in
  const maxBet = Math.max(...table.seats.map(s=>s ? s.bet : 0));
  const unsettled = table.seats.some(s => s && s.username && s.inHand && !s.folded && s.bet !== maxBet && s.chips>0);
  if(!unsettled){
    // collect bets and move on
    const collected = table.seats.reduce((acc,s)=>{
      if(s && s.bet){ acc += s.bet; s.bet = 0; }
      return acc;
    },0);
    table.pot += collected;
    // move round forward
    if(table.round === "preflop"){
      // flop
      table.community.push(table.deck.pop());
      table.community.push(table.deck.pop());
      table.community.push(table.deck.pop());
      table.round = "flop";
    } else if(table.round === "flop"){
      table.community.push(table.deck.pop());
      table.round = "turn";
    } else if(table.round === "turn"){
      table.community.push(table.deck.pop());
      table.round = "river";
    } else if(table.round === "river"){
      table.round = "showdown";
      resolveShowdown();
      return;
    }
    table.currentPos = nextActive(table.dealerPos);
    broadcastPublic();
    startActionTimer();
    notifyTurn();
    return;
  } else {
    // continue round, start timer for next player
    startActionTimer();
    notifyTurn();
  }
}

// ---- WebSocket handling ----
wss.on("connection", ws=>{
  ws.username = null;
  ws.on("message", msg=>{
    let data;
    try { data = JSON.parse(msg); } catch(e){ return; }
    if(data.type === "join"){
      const username = data.username || `P${Math.floor(Math.random()*1000)}`;
      ws.username = username;
      const seatIdx = assignSeat(username, ws);
      if(seatIdx === -1){
        ws.send(JSON.stringify({ type:"msg", text:"No free seats" }));
        return;
      }
      ws.send(JSON.stringify({ type:"msg", text:`Seated at ${seatIdx}` }));
      broadcastPublic();
      // start hand if enough players
      startHandIfPossible();
    }
    if(data.type === "action"){
      // find seat
      const pos = findSeatByName(ws.username);
      if(pos===-1) return;
      if(pos !== table.currentPos){
        ws.send(JSON.stringify({ type:"msg", text:"Not your turn" }));
        return;
      }
      const act = data.action;
      const amt = data.amount;
      handleAction(pos, act, amt);
    }
  });

  ws.on("close", ()=>{
    // find seat and remove ws link (keep username to allow reconnect)
    const pos = findSeatByName(ws.username);
    if(pos!==-1){
      table.seats[pos].ws = null;
    }
  });

  // initial greet and public state
  ws.send(JSON.stringify({ type:"msg", text:"Welcome to HiPoker engine" }));
  broadcastPublic();
});

// ---- Minimal REST for convenience ----
app.post("/sit", (req,res)=>{
  const { username } = req.body;
  const idx = assignSeat(username, null);
  if(idx===-1) return res.status(400).json({ error:"full" });
  res.json({ seat: idx });
});
