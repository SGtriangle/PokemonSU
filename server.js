const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const path = require('path');
const mongoose = require('mongoose');

// ==========================================
// 1. DATABASE CONFIGURATION
// Replace this string with your actual MongoDB Atlas connection string!
const MONGO_URI = "mongodb+srv://unitegamer06_db_user:54LZzMK9WpNwMHPQ@cluster0.xxxxx.mongodb.net/PokemonSU?retryWrites=true&w=majority";
// ==========================================

// Connect to MongoDB
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas permanently!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// Define the Player Schema
const playerSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // Note: In a production app, hash this!
    saveData: { type: Object, default: null }
});

const Player = mongoose.model('Player', playerSchema);

// Serve Static Files
app.use(express.static(__dirname)); 
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Multiplayer Queue
let matchmakingQueue = [];

io.on('connection', (socket) => {
    console.log('Trainer connected:', socket.id);

    // Registration
    socket.on('register', async (data, callback) => {
        try {
            const existingUser = await Player.findOne({ username: data.user });
            if(existingUser) {
                return callback({error: 'That trainer name is taken.'});
            }
            
            const newPlayer = new Player({
                username: data.user,
                password: data.pass
            });
            await newPlayer.save();
            callback({success: true});
        } catch (err) {
            callback({error: 'Database error during registration.'});
        }
    });

    // Login
    socket.on('login', async (data, callback) => {
        try {
            const user = await Player.findOne({ username: data.user });
            if(!user || user.password !== data.pass) {
                return callback({error: 'Invalid trainer name or password.'});
            }
            socket.username = data.user; 
            callback({success: true, save: user.saveData});
        } catch (err) {
            callback({error: 'Database error during login.'});
        }
    });

    // Continuous save sync from client
    socket.on('saveData', async (payload) => {
        try {
            await Player.updateOne(
                { username: payload.user }, 
                { $set: { saveData: payload.data } }
            );
        } catch (err) {
            console.error('Failed to sync save data:', err);
        }
    });

    // PvP Arena Matchmaking
    socket.on('joinQueue', (playerData) => {
        const player = { 
            id: socket.id, 
            user: playerData.user, 
            elo: playerData.elo, 
            team: playerData.team.map(mon => ({...mon, hp: mon.maxhp})) // Ensure full heal
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
        socket.to(data.room).emit('enemyAction', data);
    });

    socket.on('disconnect', () => {
        matchmakingQueue = matchmakingQueue.filter(p => p.id !== socket.id);
        console.log('Trainer disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`PokemonSU Server is running on port ${PORT}`);
});