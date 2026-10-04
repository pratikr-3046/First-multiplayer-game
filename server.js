const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));

// --- 1. THE ARENA MAP ---
const mapLayout = [
  "##############################################",
  "#                                            #",
  "#                                            #",
  "#                                            #",
  "#      ######                    ######      #",
  "#      #                              #      #",
  "#      #                              #      #",
  "#      #                              #      #",
  "#      #                              #      #",
  "#      #          #        #          #      #",
  "#                 #        #                 #",
  "#                 #        #                 #",
  "#                 #        #                 #",
  "#            ######        ######            #",
  "#                                            #",
  "#                                            #",
  "#                                            #",
  "#            ######        ######            #",
  "#                 #        #                 #",
  "#                 #        #                 #",
  "#                 #        #                 #",
  "#      #          #        #          #      #",
  "#      #                              #      #",
  "#      #                              #      #",
  "#      #                              #      #",
  "#      #                              #      #",
  "#      ######                    ######      #",
  "#                                            #",
  "#                                            #",
  "#                                            #",
  "##############################################"
];

const TILE_SIZE = 25; 
const walls = [];
const spawnPoints = []; 

const offsetX = (mapLayout[0].length * TILE_SIZE) / 2;
const offsetZ = (mapLayout.length * TILE_SIZE) / 2;

for (let row = 0; row < mapLayout.length; row++) {
  for (let col = 0; col < mapLayout[row].length; col++) {
    const xPos = col * TILE_SIZE - offsetX + (TILE_SIZE / 2);
    const zPos = row * TILE_SIZE - offsetZ + (TILE_SIZE / 2);
    if (mapLayout[row][col] === '#') {
      walls.push({ x: xPos, z: zPos, size: TILE_SIZE });
    } else if (mapLayout[row][col] === ' ') {
      spawnPoints.push({ x: xPos, z: zPos });
    }
  }
}

function getRandomSpawn() {
  return spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
}

// --- 2. GAME STATE & ITEMS ---
const players = {};
const bullets = [];
const pickups = []; // Stores ammo and shields on the ground
let gameOver = false;
let winnerColor = null;

const PLAYER_SPEED = 2; 
const BULLET_SPEED = 10;
const GRAVITY = 0.5;
const JUMP_FORCE = 8;
const GROUND_LEVEL = 10; 
const PLAYER_RADIUS = 5; 

// Helper to spawn items
let pickupIdCounter = 0;
function spawnPickup(type) {
  const spawn = getRandomSpawn();
  pickups.push({
    id: pickupIdCounter++,
    type: type, // 'ammo' or 'shield'
    x: spawn.x,
    z: spawn.z
  });
}

// Initial Items on the map
for(let i = 0; i < 5; i++) spawnPickup('ammo');
for(let i = 0; i < 2; i++) spawnPickup('shield');

// --- 3. SOCKET CONNECTION ---
io.on('connection', (socket) => {
  socket.emit('initMap', walls);

  const spawn = getRandomSpawn();
  players[socket.id] = {
    id: socket.id,
    x: spawn.x, y: GROUND_LEVEL, z: spawn.z, 
    vy: 0, yaw: 0, pitch: 0,
    color: Math.random() * 0xffffff,
    inputs: { forward: false, backward: false, left: false, right: false, jump: false },
    health: 100, score: 0, 
    ammo: 0, shieldTimer: 0 // New stats!
  };

  socket.on('playerState', (data) => {
    if (players[socket.id]) {
      players[socket.id].inputs = data.inputs;
      players[socket.id].yaw = data.yaw;
      players[socket.id].pitch = data.pitch;
    }
  });

  socket.on('shoot', () => {
    const p = players[socket.id];
    if (!p || gameOver) return;
    
    if (p.ammo > 0) {
      p.ammo--; // Deduct ammo
      bullets.push({
        x: p.x, y: p.y, z: p.z,
        vx: -Math.sin(p.yaw) * Math.cos(p.pitch) * BULLET_SPEED,
        vy: Math.sin(p.pitch) * BULLET_SPEED,
        vz: -Math.cos(p.yaw) * Math.cos(p.pitch) * BULLET_SPEED,
        owner: socket.id, life: 100
      });
    }
  });

  socket.on('disconnect', () => delete players[socket.id]);
});

// --- 4. SERVER LOOP ---
setInterval(() => {
  if (gameOver) return; // Freeze the game if someone won

  for (const id in players) {
    const p = players[id];
    
    // Shield Timer Countdown (60 frames = 1 second)
    if (p.shieldTimer > 0) p.shieldTimer--;

    let nextX = p.x; let nextZ = p.z;
    if (p.inputs.forward) { nextX -= Math.sin(p.yaw) * PLAYER_SPEED; nextZ -= Math.cos(p.yaw) * PLAYER_SPEED; }
    if (p.inputs.backward) { nextX += Math.sin(p.yaw) * PLAYER_SPEED; nextZ += Math.cos(p.yaw) * PLAYER_SPEED; }
    if (p.inputs.left) { nextX -= Math.cos(p.yaw) * PLAYER_SPEED; nextZ += Math.sin(p.yaw) * PLAYER_SPEED; }
    if (p.inputs.right) { nextX += Math.cos(p.yaw) * PLAYER_SPEED; nextZ -= Math.sin(p.yaw) * PLAYER_SPEED; }

    let hitX = false; let hitZ = false;
    for (const w of walls) {
      if (Math.abs(nextX - w.x) < (PLAYER_RADIUS + w.size/2) && Math.abs(p.z - w.z) < (PLAYER_RADIUS + w.size/2)) hitX = true;
      if (Math.abs(p.x - w.x) < (PLAYER_RADIUS + w.size/2) && Math.abs(nextZ - w.z) < (PLAYER_RADIUS + w.size/2)) hitZ = true;
    }

    if (!hitX) p.x = nextX;
    if (!hitZ) p.z = nextZ;

    if (p.inputs.jump && p.y <= GROUND_LEVEL) p.vy = JUMP_FORCE;
    p.vy -= GRAVITY; 
    p.y += p.vy; 
    if (p.y <= GROUND_LEVEL) { p.y = GROUND_LEVEL; p.vy = 0; }

    // Check Item Pickups
    for (let i = pickups.length - 1; i >= 0; i--) {
      const item = pickups[i];
      const distance = Math.sqrt(Math.pow(p.x - item.x, 2) + Math.pow(p.z - item.z, 2));
      
      if (distance < 12) { // Player touched item
        if (item.type === 'ammo' && p.shieldTimer <= 0) {
          p.ammo += 4;
          pickups.splice(i, 1);
          spawnPickup('ammo'); // Respawn ammo instantly somewhere else
        } 
        else if (item.type === 'shield') {
          p.shieldTimer = 300; // 5 seconds of invincibility at 60fps
          pickups.splice(i, 1);
          setTimeout(() => spawnPickup('shield'), 10000); // Respawn shield after 10 seconds
        }
      }
    }
  }

  // Update Bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx; b.y += b.vy; b.z += b.vz; b.life--;

    let destroyed = false;
    for (const w of walls) {
      if (Math.abs(b.x - w.x) < (w.size/2) && Math.abs(b.z - w.z) < (w.size/2) && b.y >= 0 && b.y <= 50) {
        destroyed = true; break;
      }
    }
    
    if (!destroyed) {
      for (const id in players) {
        if (id === b.owner) continue;
        const p = players[id];
        
        // Skip damage if player has an active shield!
        if (p.shieldTimer > 0) continue; 

        const distance = Math.sqrt(Math.pow(p.x - b.x, 2) + Math.pow((p.y - 10) - b.y, 2) + Math.pow(p.z - b.z, 2));

        if (distance < 12) {
          p.health -= 25;
          destroyed = true;
          
          if (p.health <= 0) {
            if (players[b.owner]) {
              players[b.owner].score++;
              
              // 10 KILLS WIN CONDITION
              if (players[b.owner].score >= 10) {
                gameOver = true;
                winnerColor = Math.floor(players[b.owner].color).toString(16); // Hex color of winner
                
                // Restart game after 5 seconds
                setTimeout(() => {
                  for (const pid in players) {
                    players[pid].score = 0;
                    players[pid].health = 100;
                    players[pid].ammo = 0;
                    players[pid].shieldTimer = 0;
                    const s = getRandomSpawn();
                    players[pid].x = s.x; players[pid].z = s.z;
                  }
                  gameOver = false;
                  winnerColor = null;
                }, 5000);
              }
            }
            const respawn = getRandomSpawn();
            p.x = respawn.x; p.z = respawn.z; 
            p.health = 100;
          }
          break;
        }
      }
    }

    if (destroyed || b.life <= 0 || b.y <= 0) bullets.splice(i, 1);
  }

  // Send state, including pickups and win status
  io.emit('gameState', { players, bullets, pickups, gameOver, winnerColor });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));