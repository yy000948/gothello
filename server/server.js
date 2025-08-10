const express = require('express');
const path = require('path');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();

app.use(cors());
app.use(express.static(path.join(__dirname, 'public'))); // 把 html 放 public 里


const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// 内存存储：roomId -> { players:[socketId1, socketId2], state, historyStack }
const rooms = new Map();

const SIZE = 9;
const CORNERS = [[0, 0], [0, 8], [8, 0], [8, 8]];
const nei = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/* —————— 工具函数 —————— */
const copy = b => b.map(r => [...r]);
const isCorner = (x, y) => CORNERS.some(c => c[0] === x && c[1] === y);

function grp(board, x, y, color) {
    const v = Array(SIZE).fill().map(() => Array(SIZE).fill(false));
    const q = [[x, y]], g = [];
    while (q.length) {
        const [cx, cy] = q.pop();
        if (cx < 0 || cx >= SIZE || cy < 0 || cy >= SIZE || v[cy][cx] || board[cy][cx] !== color) continue;
        v[cy][cx] = true; g.push([cx, cy]);
        nei.forEach(([dx, dy]) => q.push([cx + dx, cy + dy]));
    }
    return g;
}
function lib(board, g) {
    return g.some(([x, y]) => nei.some(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        return nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && board[ny][nx] === null;
    }));
}
function getCaptureScore(x, y) {
    const d = Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y);
    const map = [9, 7, 5, 3, 1];
    return map[d] || 0;
}

/* —————— 一局游戏的纯逻辑 —————— */
function createInitialState() {
    return {
        board: Array(SIZE).fill().map(() => Array(SIZE).fill(null)),
        turn: 'black',
        move: 0,
        black: 0,
        white: 0,
        stage: 'go',
        koPoint: null,
        lastMove: null,
        passCount: 0,
        over: false
    };
}

function goMove(state, x, y) {
    if (state.board[y][x] !== null) return false;
    if (state.koPoint && state.koPoint[0] === x && state.koPoint[1] === y) return false;
    const nb = copy(state.board);
    nb[y][x] = state.turn;
    const opp = state.turn === 'black' ? 'white' : 'black';
    const capturedSet = new Set();
    nei.forEach(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE || nb[ny][nx] !== opp) return;
        const g = grp(nb, nx, ny, opp);
        if (!lib(nb, g)) g.forEach(([cx, cy]) => capturedSet.add(`${cx},${cy}`));
    });
    const caps = [...capturedSet].map(s => s.split(',').map(Number));
    caps.forEach(([cx, cy]) => nb[cy][cx] = null);
    const self = grp(nb, x, y, state.turn);
    if (!lib(nb, self) && caps.length === 0) return false;
    const koCandidate = (caps.length === 1 && self.length === 1) ? caps[0] : null;
    let score = 0;
    caps.forEach(([cx, cy]) => score += getCaptureScore(cx, cy));
    return {
        board: nb,
        capturedScore: score,
        koPoint: koCandidate
    };
}

function othFlip(board, x, y, color) {
    const dirs = [...nei, [-1, -1], [-1, 1], [1, -1], [1, 1]];
    const flip = [];
    dirs.forEach(([dx, dy]) => {
        let nx = x + dx, ny = y + dy, temp = [];
        while (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && board[ny][nx] === (color === 'black' ? 'white' : 'black')) {
            temp.push([nx, ny]); nx += dx; ny += dy;
        }
        if (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && board[ny][nx] === color && temp.length) flip.push(...temp);
    });
    return flip;
}

function othMove(state, x, y) {
    if (state.board[y][x] !== null) return false; 
    const f = othFlip(state.board, x, y, state.turn);
    if (f.length === 0) return false;
    const nb = copy(state.board);
    nb[y][x] = state.turn;
    f.forEach(([fx, fy]) => nb[fy][fx] = state.turn);
    return { board: nb };
}

function hasLegalMove(state, color) {
    const tmp = state.turn; state.turn = color;
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            if (state.board[y][x] !== null) continue; 
            if (othFlip(state.board, x, y, color).length) {
                state.turn = tmp;
                return true;
            }
        }
    }
    state.turn = tmp;
    return false;
}

function full(state) {
    for (let y = 0; y < SIZE; y++)for (let x = 0; x < SIZE; x++)if (state.board[y][x] === null) return false;
    return true;
}

function nextState(state, x, y) {
    const newState = JSON.parse(JSON.stringify(state));
    let res;
    if (state.stage === 'go') {
        if (isCorner(x, y)) return null;
        res = goMove(state, x, y);
        if (!res) return null;
        newState.board = res.board;
        if (state.turn === 'black') newState.black += res.capturedScore;
        else newState.white += res.capturedScore;
        newState.koPoint = res.koPoint;
    } else {
        res = othMove(state, x, y);
        if (!res) return null;
        newState.board = res.board;
    }
    newState.lastMove = [x, y];
    newState.passCount = 0;
    newState.turn = state.turn === 'black' ? 'white' : 'black';
    newState.move++;
    if (newState.move >= 60 && newState.stage === 'go') {
        newState.stage = 'othello';
        newState.turn = 'black';
    }
    while (newState.stage === 'othello' && !hasLegalMove(newState, newState.turn) && !newState.over) {
        newState.turn = newState.turn === 'black' ? 'white' : 'black';
        if (!hasLegalMove(newState, 'black') && !hasLegalMove(newState, 'white')) {
            finalize(newState); break;
        }
    }
    if (full(newState)) finalize(newState);
    return newState;
}

function finalize(state) {
    let b = state.black, w = state.white;
    for (let y = 0; y < SIZE; y++)for (let x = 0; x < SIZE; x++) {
        if (state.board[y][x] === 'black') b++;
        else if (state.board[y][x] === 'white') w++;
    }
    state.black = b; state.white = w; state.over = true;
}

/* —————— Socket.IO 房间管理 —————— */
io.on('connection', socket => {
    socket.on('joinRoom', ({ roomId, side }) => {
        if (!rooms.has(roomId)) {
            rooms.set(roomId, {
                players: [socket.id, null],
                state: createInitialState(),
                historyStack: []
            });
            socket.join(roomId);
            socket.emit('joined', { roomId, side: 'black' });
            return;
        }
        const room = rooms.get(roomId);
        if (room.players[1]) return socket.emit('err', 'room full');
        room.players[1] = socket.id;
        socket.join(roomId);
        socket.emit('joined', { roomId, side: 'white' });
        io.to(roomId).emit('start', room.state);
    });

    socket.on('move', ({ roomId, x, y }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        const { state, historyStack } = room;
        if (state.over) return;
        const newState = nextState(state, x, y);
        if (!newState) return socket.emit('illegal');
        room.historyStack = [...historyStack, JSON.parse(JSON.stringify(state))];
        room.state = newState;
        io.to(roomId).emit('update', newState);
    });

    socket.on('pass', roomId => {
        const room = rooms.get(roomId);
        if (!room || room.state.over) return;
        const { state } = room;
        if (state.stage === 'go' && state.move < 40) return;
        room.historyStack = [...room.historyStack, JSON.parse(JSON.stringify(state))];
        state.passCount++;
        if (state.passCount === 2) {
            state.stage = 'othello';
            state.turn = 'black';
            state.passCount = 0;
            io.to(roomId).emit('update', state);
            return;
        }
        state.turn = state.turn === 'black' ? 'white' : 'black';
        state.move++;
        if (state.move >= 60 && state.stage === 'go') {
            state.stage = 'othello'; state.turn = 'black';
        }
        io.to(roomId).emit('update', state);
    });

    socket.on('undo', roomId => {
        const room = rooms.get(roomId);
        if (!room || room.state.over || room.historyStack.length === 0) return;
        room.state = room.historyStack.pop();
        io.to(roomId).emit('update', room.state);
    });

    socket.on('reset', roomId => {
        const room = rooms.get(roomId);
        if (!room) return;
        room.state = createInitialState();
        room.historyStack = [];
        io.to(roomId).emit('update', room.state);
    });

    socket.on('disconnect', () => {
        for (const [id, room] of rooms.entries()) {
            if (room.players.includes(socket.id)) {
                io.to(id).emit('peerLeft');
                rooms.delete(id);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log('Server on', PORT));