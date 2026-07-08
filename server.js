const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const fs = require('fs');
const path = require('path');

app.use(express.static(__dirname)); 

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Database Setup
const DB_FILE = 'database.json';
let DB = {};
if (fs.existsSync(DB_FILE)) {
    DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} else {
    fs.writeFileSync(DB_FILE, JSON.stringify(DB));
}

function saveDB() {
    fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2));
}

let matchmakingQueue = [];

io.on('connection', (socket) => {
    console.log('Trainer connected:', socket.id);

    // Registration
    socket.on('register', (data, callback) => {
        if(DB[data.user]) {
            return callback({error: 'That trainer name is taken.'});
        }
        DB[data.user] = { pass: data.pass, save: null };
        saveDB();
        callback({success: true});
    });

    // Login
    socket.on('login', (data, callback) => {
        const user = DB[data.user];
        if(!user || user.pass !== data.pass) {
            return callback({error: 'Invalid trainer name or password.'});
        }
        socket.username = data.user; // attach to socket session
        callback({success: true, save: user.save});
    });

    // Continuous save sync from client
    socket.on('saveData', (payload) => {
        if(DB[payload.user]) {
            DB[payload.user].save = payload.data;
            saveDB();
        }
    });

    // PvP Arena Matchmaking
    socket.on('joinQueue', (playerData) => {
        const player = { 
            id: socket.id, 
            user: playerData.user, 
            elo: playerData.elo, 
            team: playerData.team.map(mon => ({...mon, hp: mon.maxhp})) // ensure full heal
        };
        
        if (matchmakingQueue.length > 0) {
            const opponent = matchmakingQueue.pop();
            const battleId = `battle_${Date.now()}`;
            
            socket.join(battleId);
            io.sockets.sockets.get(opponent.id).join(battleId);

            // Send opponent data to both players
            io.to(player.id).emit('matchFound', { room: battleId, opponent: opponent });
            io.to(opponent.id).emit('matchFound', { room: battleId, opponent: player });
        } else {
            matchmakingQueue.push(player);
        }
    });

    // Handle Peer-to-Peer Battle Actions
    socket.on('playerAction', (data) => {
        // Relay the action (move, damage, switch, faint, win) to the other person in the room
        socket.to(data.room).emit('enemyAction', data);
    });

    socket.on('disconnect', () => {
        matchmakingQueue = matchmakingQueue.filter(p => p.id !== socket.id);
        console.log('Trainer disconnected:', socket.id);
    });
});

const PORT = 3000;
http.listen(PORT, () => {
    console.log(`PokemonSU Backend & PvP Server is running on http://localhost:${PORT}`);
});