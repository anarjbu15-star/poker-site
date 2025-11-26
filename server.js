
const express = require('express');
const path = require('path');
const WebSocket = require('ws');
const app = express();

const PORT = process.env.PORT || 10000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let users = {};

app.post('/register', (req,res)=>{
  const {username,password}=req.body;
  if(users[username]) return res.status(400).json({error:"exists"});
  users[username]={password, chips:1000};
  res.json({success:true});
});

app.post('/login',(req,res)=>{
  const {username,password}=req.body;
  if(!users[username] || users[username].password!==password)
    return res.status(401).json({error:"invalid"});
  res.json({success:true, username});
});

const httpServer = app.listen(PORT, ()=>console.log("Server on "+PORT));

const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', ws=>{
  ws.send(JSON.stringify({msg:"WS connected"}));
});
