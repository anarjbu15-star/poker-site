// public/game.js
let ws;
let seatIdx = -1;
let myName = "";

document.getElementById('enterBtn').onclick = () => {
  const v = document.getElementById('username').value.trim();
  if(!v) return alert('Enter a name');
  myName = v;
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('lobby-screen').classList.remove('hidden');
  document.getElementById('player-name').innerText = myName;
  connect();
};

document.getElementById('joinBtn').onclick = () => {
  ws.send(JSON.stringify({ type: 'join', name: myName }));
};

function connect(){
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = scheme + '//' + location.host;
  ws = new WebSocket(url);
  ws.onopen = () => console.log('ws open');
  ws.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    handleMessage(data);
  };
  ws.onclose = () => console.log('ws closed');
}

function handleMessage(data){
  if(data.type === 'msg'){ console.log('MSG', data.text); return; }
  if(data.type === 'seated'){ seatIdx = data.idx; document.getElementById('lobby-screen').classList.add('hidden'); document.getElementById('table-screen').classList.remove('hidden'); }
  if(data.type === 'table'){
    renderTable(data);
  }
  if(data.type === 'hole'){
    renderHole(data.cards);
  }
  if(data.type === 'turn'){
    document.getElementById('current').innerText = data.pos;
    startTimer(data.time || 7);
  }
  if(data.type === 'tick'){
    document.getElementById('timer').innerText = data.timeLeft;
  }
  if(data.type === 'result'){
    alert('Showdown results: ' + JSON.stringify(data.results));
  }
}

function renderTable(t){
  // seats
  const seatsDiv = document.getElementById('seats');
  seatsDiv.innerHTML = '';
  t.seats.forEach((s,i)=>{
    const div = document.createElement('div');
    div.className = 'seat';
    // position them roughly around table (hardcoded)
    const positions = [
      {top:'6%', left:'40%'},
      {top:'20%', left:'6%'},
      {top:'60%', left:'6%'},
      {top:'82%', left:'40%'},
      {top:'60%', left:'75%'},
      {top:'20%', left:'75%'}
    ];
    div.style.top = positions[i].top;
    div.style.left = positions[i].left;
    if(s){
      div.innerHTML = `<div class="label">${s.username}<br />Chips: ${s.chips}<br/>Bet: ${s.bet}${s.folded?'<br/>(folded)':''}${s.allIn?'<br/>(all-in)':''}</div>`;
    } else div.innerHTML = `<div class="label">Empty</div>`;
    seatsDiv.appendChild(div);
  });
  // community
  const comm = document.getElementById('community-cards');
  comm.innerHTML = '';
  (t.community || []).forEach(c => {
    const img = document.createElement('img');
    img.src = `https://deckofcardsapi.com/static/img/${c}.png`;
    img.className = 'card-img';
    comm.appendChild(img);
  });
  document.getElementById('pot').innerText = t.pot || 0;
  document.getElementById('stage').innerText = t.stage;
  document.getElementById('dealer').innerText = t.dealer;
  document.getElementById('current').innerText = t.current;
}

function renderHole(cards){
  const area = document.getElementById('player-cards');
  area.innerHTML = '';
  cards.forEach(c => {
    const img = document.createElement('img');
    img.src = `https://deckofcardsapi.com/static/img/${c}.png`;
    img.className = 'card-img';
    area.appendChild(img);
  });
}

function doAction(act){
  if(!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type:'action', action: act }));
}

function doBet(){
  const a = prompt('Bet amount');
  if(!a) return;
  ws.send(JSON.stringify({ type:'action', action:'bet', amount: Number(a) }));
}

let timerInt;
function startTimer(sec){
  clearInterval(timerInt);
  let t = sec || 7;
  document.getElementById('timer').innerText = t;
  timerInt = setInterval(()=>{
    t--;
    document.getElementById('timer').innerText = t;
    if(t<=0) clearInterval(timerInt);
  },1000);
}
