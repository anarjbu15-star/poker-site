// server.js
// Full Texas Hold'em engine (single-table, in-memory)
const express = require("express");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 10000;
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

/* ----- Utilities: deck, shuffle, evaluator ----- */
const RANKS = ["2","3","4","5","6","7","8","9","0","J","Q","K","A"]; // 0 = Ten
const SUITS = ["H","D","C","S"];

function newDeck(){
  const d = [];
  for(const r of RANKS) for(const s of SUITS) d.push(r + s);
  return d;
}
function shuffle(deck){
  for(let i = deck.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Evaluator: score a 5-card hand
function rankVal(r){ return RANKS.indexOf(r); }
function score5(cards){
  // cards: [{0:'A',1:'H'}? but we'll pass strings like 'AH']
  // compute rank counts
  const cnt = {};
  for(const c of cards){
    const r = c[0];
    cnt[r] = (cnt[r] || 0) + 1;
  }
  const counts = Object.values(cnt).sort((a,b)=>b-a);
  const ranksSorted = Object.keys(cnt).sort((a,b)=>{
    if(cnt[b] !== cnt[a]) return cnt[b] - cnt[a];
    return rankVal(b) - rankVal(a);
  });
  // flush
  const suits = cards.map(c=>c[1]);
  const flush = suits.every(s=>s===suits[0]);
  // straight
  const uniqVal = Array.from(new Set(cards.map(c=>rankVal(c[0])))).sort((a,b)=>a-b);
  let straightHigh = -1;
  if(uniqVal.length >= 5){
    for(let i=0;i<=uniqVal.length-5;i++){
      let ok = true;
      for(let j=0;j<4;j++) if(uniqVal[i+j+1] !== uniqVal[i+j] + 1) { ok = false; break; }
      if(ok) straightHigh = uniqVal[i+4];
    }
    // wheel
    const wheel = [0,1,2,3,12];
    const tail = uniqVal.slice(-5);
    if(tail.length===5 && tail.toString()===wheel.toString()) straightHigh = 3;
  }
  if(straightHigh !== -1 && flush) return { name:'straight_flush', score:900000 + straightHigh };
  if(counts[0] === 4){
    const quad = rankVal(ranksSorted[0]);
    const kick = rankVal(ranksSorted[1]);
    return { name:'four', score:800000 + quad*100 + kick };
  }
  if(counts[0] === 3 && counts[1] === 2){
    return { name:'full', score:700000 + rankVal(ranksSorted[0])*100 + rankVal(ranksSorted[1]) };
  }
  if(flush){
    const sc = cards.map(c=>rankVal(c[0])).sort((a,b)=>b-a).reduce((acc,v,i)=>acc + v*(100**(4-i)),0);
    return { name:'flush', score:600000 + sc };
  }
  if(straightHigh !== -1) return { name:'straight', score:500000 + straightHigh };
  if(counts[0] === 3){
    const trip = rankVal(ranksSorted[0]);
    const kickers = ranksSorted.slice(1).map(r=>rankVal(r));
    return { name:'trips', score:400000 + trip*10000 + kickers[0]*100 + (kickers[1]||0) };
  }
  if(counts[0] === 2 && counts[1] === 2){
    const hp = rankVal(ranksSorted[0]), lp = rankVal(ranksSorted[1]), k = rankVal(ranksSorted[2]);
    return { name:'two_pair', score:300000 + hp*10000 + lp*100 + k };
  }
  if(counts[0] === 2){
    const pr = rankVal(ranksSorted[0]);
    const kick = ranksSorted.slice(1).map(r=>rankVal(r));
    return { name:'pair', score:200000 + pr*10000 + (kick[0]||0)*100 + (kick[1]||0) };
  }
  const sc = cards.map(c=>rankVal(c[0])).sort((a,b)=>b-a).reduce((acc,v,i)=>acc + v*(100**(4-i)),0);
  return { name:'high', score:100000 + sc };
}

// combos
function combos(arr, n){
  const res=[];
  function go(start, chosen){
    if(chosen.length===n){ res.push(chosen.slice()); return; }
    for(let i=start;i<arr.length;i++){ chosen.push(arr[i]); go(i+1, chosen); chosen.pop(); }
  }
  go(0, []);
  return res;
}
function bestFrom7(cards7){
  const c5s = combos(cards7,5);
  let best = null;
  for(const c5 of c5s){
    const sc = score5(c5);
    if(!best || sc.score > best.score) best = sc;
  }
  return best;
}

/* ----- Table Model ----- */
const MAX_SEATS = 6;
const ACTION_TIMEOUT = 7000; // ms
const SMALL_BLIND = 5;
const BIG_BLIND = 10;
const MIN_BET = 10;

function newTable(){
  return {
    seats: Array(MAX_SEATS).fill(null).map(()=>({
      username: null,
      ws: null,
      chips: 1000,
      inHand: false,
      folded: false,
      allIn: false,
      bet: 0,
      hole: []
    })),
    deck: [],
    community: [],
    pot: 0,
    dealer: -1,
    current: -1,
    stage: 'idle', // idle, preflop, flop, turn, river, showdown
    lastBet: 0,
    actionTimer: null
  };
}
const table = newTable();

/* ----- Helper utilities ----- */
function send(ws, payload){
  if(ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}
function broadcast(payload){
  table.seats.forEach(s => { if(s && s.ws) send(s.ws, payload); });
}
function publicState(){
  return {
    type: 'table',
    seats: table.seats.map(s => s.username ? {
      username: s.username,
      chips: s.chips,
      inHand: s.inHand,
      folded: s.folded,
      allIn: s.allIn,
      bet: s.bet
    } : null),
    community: table.community,
    pot: table.pot,
    stage: table.stage,
    dealer: table.dealer,
    current: table.current,
    lastBet: table.lastBet
  };
}
function findSeatByName(name){ return table.seats.findIndex(s => s.username === name); }
function firstEmptySeat(){ return table.seats.findIndex(s => !s.username); }
function nextSeat(pos){
  for(let i=1;i<=MAX_SEATS;i++){
    const idx = (pos + i) % MAX_SEATS;
    if(table.seats[idx] && table.seats[idx].username) return idx;
  }
  return -1;
}
function nextActive(pos){
  for(let i=1;i<=MAX_SEATS;i++){
    const idx = (pos + i) % MAX_SEATS;
    const s = table.seats[idx];
    if(s && s.username && s.inHand && !s.folded && !s.allIn) return idx;
  }
  return -1;
}
function activePlayers(){ return table.seats.filter(s => s && s.username && s.inHand && !s.folded).length; }

/* ----- Side-pot helper ----- */
/*
  We compute pots by contributions:
  Example contributions: [100, 200, 50] -> unique levels sorted asc [50,100,200]
  For each level L, pot amount = L * (#players with contrib>=L - #players with contrib>=prevLevel)
  Simpler: iterate sorted unique contributions and form pots with eligible players.
*/
function collectPots(){
  const contrib = table.seats.map((s,i)=> ({ i, contrib: s._contrib || 0, username: s.username }));
  const uniq = Array.from(new Set(contrib.map(c=>c.contrib))).sort((a,b)=>a-b).filter(x=>x>0);
  const pots = [];
  let prev = 0;
  for(const level of uniq){
    const elig = contrib.filter(c=>c.contrib >= level);
    const amount = (level - prev) * elig.length;
    pots.push({ amount: amount, eligible: elig.map(e=>e.i) });
    prev = level;
  }
  return pots;
}

/* ----- Game flow functions ----- */
function startHand(){
  // reset structure
  table.deck = shuffle(newDeck());
  table.community = [];
  table.pot = 0;
  table.stage = 'preflop';
  table.lastBet = BIG_BLIND;
  // rotate dealer
  table.dealer = (table.dealer + 1) % MAX_SEATS;
  // mark inHand and deal hole cards
  for(let i=0;i<MAX_SEATS;i++){
    const s = table.seats[i];
    if(s && s.username && s.chips > 0){
      s.inHand = true; s.folded = false; s.allIn = false; s.bet = 0; s.hole = [table.deck.pop(), table.deck.pop()];
      s._contrib = 0; // used for side-pot calc
      // send private hole
      send(s.ws, { type: 'hole', cards: s.hole });
    } else if(s){
      s.inHand = false; s.folded = true; s.allIn = false; s.bet = 0; s.hole = []; s._contrib = 0;
    }
  }
  // post blinds
  const sbPos = nextSeat(table.dealer);
  const bbPos = nextSeat(sbPos);
  if(sbPos === -1 || bbPos === -1) return; // not enough players
  // small blind
  postBet(sbPos, Math.min(SMALL_BLIND, table.seats[sbPos].chips));
  // big blind
  postBet(bbPos, Math.min(BIG_BLIND, table.seats[bbPos].chips));
  table.lastBet = table.seats[bbPos].bet;
  // set current to next seat after big blind
  table.current = nextActive(bbPos);
  broadcast(publicState());
  startActionTimer();
  broadcast({ type: 'turn', pos: table.current, time: ACTION_TIMEOUT/1000 });
}

function postBet(pos, amount){
  const s = table.seats[pos];
  if(!s) return;
  const pay = Math.min(amount, s.chips);
  s.chips -= pay;
  s.bet += pay;
  s._contrib = (s._contrib || 0) + pay;
  if(s.chips === 0) s.allIn = true;
  table.pot += 0; // we'll collect into pot between rounds
}

function collectBetsToPot(){
  // collect bets to the pot and reset bets (bets remain considered in _contrib for side pots)
  const collected = table.seats.reduce((acc,s)=> { if(s) { acc += s.bet; s.bet = 0; } return acc; }, 0);
  table.pot += collected;
}

function startActionTimer(){
  clearActionTimer();
  let timeLeft = ACTION_TIMEOUT;
  table.actionTimer = setInterval(()=>{
    timeLeft -= 1000;
    broadcast({ type: 'tick', pos: table.current, timeLeft: Math.max(0, Math.ceil(timeLeft/1000)) });
    if(timeLeft <= 0){
      clearActionTimer();
      // auto fold current
      const pos = table.current;
      if(pos !== -1) handleAction(pos, 'fold', 0);
    }
  }, 1000);
}

function clearActionTimer(){ if(table.actionTimer){ clearInterval(table.actionTimer); table.actionTimer = null; } }

function advanceTurn(){
  // find next player who is inHand and not folded and not allIn
  let next = table.current;
  for(let i=1;i<=MAX_SEATS;i++){
    const idx = (table.current + i) % MAX_SEATS;
    const s = table.seats[idx];
    if(s && s.username && s.inHand && !s.folded && !s.allIn) { next = idx; break; }
  }
  table.current = next;
  broadcast(publicState());
  startActionTimer();
  broadcast({ type:'turn', pos: table.current, time: ACTION_TIMEOUT/1000 });
}

function bettingRoundCompleted(){
  // Betting round ends when all active players (inHand, not folded) have bet equal, or are all-in.
  const active = table.seats.filter(s => s && s.username && s.inHand && !s.folded);
  if(active.length <= 1) return true;
  const maxBet = Math.max(...active.map(s=>s.bet));
  for(const s of active){
    if(!s.allIn && s.bet !== maxBet) return false;
  }
  return true;
}

function advanceStage(){
  // Move preflop -> flop -> turn -> river -> showdown
  collectBetsToPot();
  if(activePlayers() <= 1){
    // award pot to remaining
    const winnerIdx = table.seats.findIndex(s => s && s.username && s.inHand && !s.folded);
    if(winnerIdx !== -1){
      table.seats[winnerIdx].chips += table.pot;
      broadcast({ type:'msg', text: `${table.seats[winnerIdx].username} wins ${table.pot}` });
      table.pot = 0;
    }
    table.stage = 'idle';
    broadcast(publicState());
    setTimeout(() => { tryStartHand(); }, 2000);
    return;
  }
  if(table.stage === 'preflop'){
    // deal flop (3)
    table.community.push(table.deck.pop(), table.deck.pop(), table.deck.pop());
    table.stage = 'flop';
  } else if(table.stage === 'flop'){
    table.community.push(table.deck.pop());
    table.stage = 'turn';
  } else if(table.stage === 'turn'){
    table.community.push(table.deck.pop());
    table.stage = 'river';
  } else if(table.stage === 'river'){
    table.stage = 'showdown';
    doShowdown();
    return;
  }
  // reset bets for new round
  table.lastBet = MIN_BET;
  // set current to next active after dealer
  table.current = nextActive(table.dealer);
  broadcast(publicState());
  startActionTimer();
  broadcast({ type:'turn', pos: table.current, time: ACTION_TIMEOUT/1000 });
}

function tryStartHand(){
  // Start a hand if >=2 players with chips and not already in a hand
  const eligible = table.seats.filter(s=>s && s.username && s.chips>0);
  if(eligible.length >= 2){
    startHand();
  }
}

/* ----- Action handling ----- */
function handleAction(pos, action, amount){
  const s = table.seats[pos];
  if(!s || !s.username || !s.inHand || s.folded) return;
  clearActionTimer();
  if(action === 'fold'){
    s.folded = true; s.inHand = false;
    broadcast({ type:'msg', text: `${s.username} folds` });
  } else if(action === 'check'){
    broadcast({ type:'msg', text: `${s.username} checks` });
  } else if(action === 'call'){
    const maxBet = Math.max(...table.seats.map(x => x ? x.bet : 0));
    const need = maxBet - s.bet;
    const pay = Math.min(need, s.chips);
    s.chips -= pay; s.bet += pay; s._contrib = (s._contrib||0) + pay;
    if(s.chips === 0) s.allIn = true;
    broadcast({ type:'msg', text: `${s.username} calls ${pay}` });
  } else if(action === 'bet' || action === 'raise'){
    const amt = Number(amount) || MIN_BET;
    const toPut = Math.min(amt, s.chips);
    s.chips -= toPut; s.bet += toPut; s._contrib = (s._contrib||0) + toPut;
    if(s.chips === 0) s.allIn = true;
    table.lastBet = s.bet;
    broadcast({ type:'msg', text: `${s.username} bets ${toPut}` });
  } else if(action === 'allin'){
    const toPut = s.chips;
    s.bet += toPut; s._contrib = (s._contrib||0) + toPut; s.chips = 0; s.allIn = true;
    table.lastBet = Math.max(table.lastBet, s.bet);
    broadcast({ type:'msg', text: `${s.username} goes all-in ${toPut}` });
  }

  // if only one left -> award pot
  if(activePlayers() <= 1){
    advanceStage();
    return;
  }
  // if betting round completed -> advanceStage
  if(bettingRoundCompleted()){
    advanceStage();
    return;
  }
  // else advance to next player who can act
  // find next index with inHand & not folded & not allIn
  let next = table.current;
  for(let i=1;i<=MAX_SEATS;i++){
    const idx = (table.current + i) % MAX_SEATS;
    const cand = table.seats[idx];
    if(cand && cand.username && cand.inHand && !cand.folded && !cand.allIn){
      next = idx; break;
    }
  }
  table.current = next;
  broadcast(publicState());
  startActionTimer();
  broadcast({ type:'turn', pos: table.current, time: ACTION_TIMEOUT/1000 });
}

/* ----- Showdown & side-pots ----- */
function doShowdown(){
  collectBetsToPot(); // collect remaining bets
  // Compute pots by contributions
  const pots = collectPots(); // array of {amount, eligible: [seatIdx,...]}
  // For each pot, find best hand among eligible players
  const results = [];
  for(const pot of pots){
    let bestScore = null;
    let winners = [];
    for(const idx of pot.eligible){
      const s = table.seats[idx];
      if(!s || s.folded) continue;
      const all = [...s.hole, ...table.community];
      const sc = bestFrom7(all);
      if(!bestScore || sc.score > bestScore.score){
        bestScore = sc; winners = [idx];
      } else if(sc.score === bestScore.score) {
        winners.push(idx);
      }
    }
    const share = Math.floor(pot.amount / winners.length);
    winners.forEach(w => table.seats[w].chips += share);
    results.push({ pot: pot.amount, winners: winners.map(i=>table.seats[i].username), share });
  }
  broadcast({ type:'result', results });
  table.pot = 0;
  table.stage = 'idle';
  broadcast(publicState());
  setTimeout(()=> tryStartHand(), 4000);
}

/* ----- WebSocket handlers ----- */
wss.on('connection', ws => {
  ws.on('message', m => {
    let data;
    try { data = JSON.parse(m); } catch(e){ return; }
    if(data.type === 'join'){
      const name = data.name || `P${Math.floor(Math.random()*1000)}`;
      // seat player
      let idx = findSeatByName(name);
      if(idx === -1) idx = firstEmptySeat();
      if(idx === -1){
        send(ws, { type:'msg', text: 'Table full' }); return;
      }
      const seat = table.seats[idx];
      seat.username = name; seat.ws = ws;
      send(ws, { type:'seated', idx });
      broadcast(publicState());
      tryStartHand();
    }
    if(data.type === 'action'){
      // find seat by ws
      const pos = table.seats.findIndex(s => s.ws === ws);
      if(pos === -1){ send(ws, { type:'msg', text:'Not seated' }); return; }
      // only allow action if it's player's turn (or it's an all-in/call not requiring turn check for robustness)
      if(pos !== table.current){
        // but allow fold/check/call if server tolerant (strict: reject)
        if(data.action !== 'fold') { send(ws, { type:'msg', text:'Not your turn' }); return; }
      }
      handleAction(pos, data.action, data.amount);
    }
  });

  ws.on('close', () => {
    // remove ws link but keep username so reconnection possible
    const pos = table.seats.findIndex(s => s.ws === ws);
    if(pos !== -1) table.seats[pos].ws = null;
  });

  // initial send
  send(ws, { type:'msg', text:'Welcome to HiPoker (Texas Hold\'em)' });
  send(ws, publicState());
});

/* ----- HTTP helper routes (optional) ----- */
app.get('/status', (req,res) => res.json({ ok:true, table: publicState() }));

/* ----- Start server ----- */
server.listen(PORT, () => console.log("Server listening on", PORT));
