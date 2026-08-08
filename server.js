'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const CONFIG_PATH = path.join(__dirname, 'config.json');
const DATA_DIR = path.join(__dirname, 'data');
const ROOMS_PATH = path.join(DATA_DIR, 'rooms.json');
const TURKISH_LETTERS = ['A','B','C','Ç','D','E','F','G','Ğ','H','I','İ','J','K','L','M','N','O','Ö','P','R','S','Ş','T','U','Ü','V','Y','Z'];
const CATEGORIES = [
  { key: 'name', label: 'İsim' },
  { key: 'city', label: 'Şehir' },
  { key: 'animal', label: 'Hayvan' },
  { key: 'plant', label: 'Bitki' },
  { key: 'item', label: 'Eşya' },
  { key: 'country', label: 'Ülke' },
  { key: 'job', label: 'Meslek' },
  { key: 'food', label: 'Yemek' },
  { key: 'brand', label: 'Marka' },
  { key: 'famous', label: 'Ünlü' }
];
const MIN_PLAYERS = 2;
const MAX_ROUNDS = 20;
const LAST_PLAYER_TIMEOUT_MS = Math.max(1_000, Number(process.env.LAST_PLAYER_TIMEOUT_MS || 60_000));
// Ağ/SSE kopması oyuncuyu odadan atmaz. Yalnızca çok uzun süre tamamen kaybolan oturumlar temizlenir.
const MEMBER_IDLE_TTL_MS = Math.max(15 * 60_000, Number(process.env.MEMBER_IDLE_TTL_MS || 2 * 60 * 60_000));
// Kısa refresh/VPN kopmalarında oyuncuyu koru; gerçek kopuşlarda hayalet oyuncu bırakma.
const READY_DISCONNECT_GRACE_MS = Math.max(5_000, Number(process.env.READY_DISCONNECT_GRACE_MS || 30_000));
const DISCONNECTED_MEMBER_TTL_MS = Math.max(5 * 60_000, Number(process.env.DISCONNECTED_MEMBER_TTL_MS || 30 * 60_000));
const QUICK_ACTIVE_MS = Math.max(15_000, Number(process.env.QUICK_ACTIVE_MS || 90_000));

let fileConfig = {};
try { fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
const DISCORD_INVITE_URL = cleanConfigUrl(process.env.DISCORD_INVITE_URL || fileConfig.discordInviteUrl || '');

const rooms = new Map();                 // roomCode -> room
const clients = new Map();               // transport clientId -> SSE response
const clientRoom = new Map();            // transport clientId -> roomCode

function roomSnapshot(room) {
  return {
    code: room.code,
    version: Number(room.version || 0),
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    isPrivate: Boolean(room.isPrivate),
    status: room.status,
    configuredRounds: room.configuredRounds,
    startRequest: room.startRequest || null,
    players: (room.players || []).map(p => ({
      id: p.id, memberToken: p.memberToken, profileId: p.profileId || '', name: p.name,
      gender: p.gender, avatar: p.avatar, clientId: null, ready: Boolean(p.ready),
      score: Number(p.score || 0), roundScore: Number(p.roundScore || 0),
      lastSeen: Number(p.lastSeen || Date.now()), disconnectedAt: Date.now()
    })),
    round: Number(room.round || 0), totalRounds: Number(room.totalRounds || 0),
    turnOrder: [...(room.turnOrder || [])], currentChooserId: room.currentChooserId || null,
    letter: room.letter || null, usedLetters: [...(room.usedLetters || [])],
    submissions: room.submissions || {}, reviewItems: room.reviewItems || [], reviewVotes: room.reviewVotes || {},
    deadline: room.deadline || null, createdAt: Number(room.createdAt || Date.now())
  };
}

function persistRooms() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const temp = `${ROOMS_PATH}.tmp`;
    const payload = JSON.stringify({ version: 1, savedAt: Date.now(), rooms: [...rooms.values()].map(roomSnapshot) });
    fs.writeFileSync(temp, payload, 'utf8');
    fs.renameSync(temp, ROOMS_PATH);
  } catch (err) {
    console.warn('Oda durumu kaydedilemedi:', err?.message || err);
  }
}

function reviveRoom(raw) {
  if (!raw?.code || !Array.isArray(raw.players) || !raw.players.length) return null;
  const code = normalizeRoomCode(raw.code);
  if (code.length !== 5) return null;
  const room = {
    ...raw,
    code,
    version: Number(raw.version || 0),
    maxPlayers: Math.max(2, Math.min(10, Number(raw.maxPlayers) || 6)),
    configuredRounds: Math.max(1, Math.min(MAX_ROUNDS, Number(raw.configuredRounds) || 3)),
    players: raw.players.map(p => ({ ...p, clientId: null, ready: Boolean(p.ready), lastSeen: Number(p.lastSeen || Date.now()), disconnectedAt: Date.now() })),
    turnOrder: Array.isArray(raw.turnOrder) ? raw.turnOrder : [],
    usedLetters: Array.isArray(raw.usedLetters) ? raw.usedLetters : [],
    submissions: raw.submissions && typeof raw.submissions === 'object' ? raw.submissions : {},
    reviewItems: Array.isArray(raw.reviewItems) ? raw.reviewItems : [],
    reviewVotes: raw.reviewVotes && typeof raw.reviewVotes === 'object' ? raw.reviewVotes : {},
    deadline: raw.deadline ? Number(raw.deadline) : null,
    timer: null,
    createdAt: Number(raw.createdAt || Date.now())
  };
  if (!room.players.some(p => p.id === room.hostId)) room.hostId = room.players[0]?.id || null;
  return room;
}

function readPersistedRooms() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ROOMS_PATH, 'utf8'));
    return Array.isArray(parsed?.rooms) ? parsed.rooms : [];
  } catch { return []; }
}

function recoverRoomFromDisk(code) {
  const key = normalizeRoomCode(code);
  const raw = readPersistedRooms().find(r => normalizeRoomCode(r?.code) === key);
  const room = reviveRoom(raw);
  if (room) rooms.set(room.code, room);
  return room;
}

function cleanConfigUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (!['https:', 'http:'].includes(u.protocol)) return '';
    return u.toString();
  } catch { return ''; }
}

function cleanText(value, max = 32) {
  return String(value ?? '')
    .replace(/[<>\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeAnswer(value) { return cleanText(value, 36).toLocaleLowerCase('tr-TR'); }
function normalizeRoomCode(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); }
function createMemberToken() { return crypto.randomBytes(24).toString('base64url'); }

function createRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let tries = 0; tries < 100; tries++) {
    let code = '';
    for (let i = 0; i < 5; i++) code += chars[crypto.randomInt(chars.length)];
    if (!rooms.has(code)) return code;
  }
  return crypto.randomBytes(4).toString('hex').slice(0, 5).toUpperCase();
}

function json(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(raw),
    'cache-control': 'no-store'
  });
  res.end(raw);
}

function sseSend(clientId, event, data) {
  const res = clients.get(clientId);
  if (!res || res.writableEnded) return;
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
}

function isPlayerConnected(player) {
  return Boolean(player?.clientId && clients.has(player.clientId));
}

function isPlayerRecentlyActive(player) {
  return Boolean(player && (isPlayerConnected(player) || Date.now() - Number(player.lastSeen || 0) < QUICK_ACTIVE_MS));
}

function isPlayerReadyActive(player) {
  return Boolean(player && (isPlayerConnected(player) || Date.now() - Number(player.lastSeen || 0) < 15_000));
}

function markPlayerActive(player) {
  if (!player) return;
  player.disconnectedAt = null;
  player.lastSeen = Date.now();
}

function scheduleDisconnectedPlayer(room, player) {
  if (!room || !player || !room.players.some(p => p.id === player.id)) return;
  player.disconnectedAt = Date.now();
  player.lastSeen = Date.now();
}

function broadcastPresence() {
  const data = { count: clients.size };
  for (const id of clients.keys()) sseSend(id, 'presence:update', data);
}

function publicRoom(room) {
  const host = room.players.find(p => p.id === room.hostId);
  return {
    code: room.code,
    maxPlayers: room.maxPlayers,
    count: room.players.length,
    isPrivate: room.isPrivate,
    status: room.status,
    hostName: host?.name || '—'
  };
}

function roomList() {
  return [...rooms.values()]
    .filter(room => {
      const host = room.players.find(p => p.id === room.hostId);
      return !room.isPrivate && room.status === 'waiting' && room.players.length < room.maxPlayers && isPlayerRecentlyActive(host);
    })
    .map(publicRoom)
    .sort((a, b) => b.count - a.count);
}

function sendRoomListToAll() {
  const list = roomList();
  for (const id of clients.keys()) sseSend(id, 'rooms:list', list);
}

function clearRoomTimer(room) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
  room.deadline = null;
}

function rankings(room) {
  return [...room.players]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'tr'))
    .map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, avatar: p.avatar, score: p.score }));
}

function viewerFor(room, clientId) {
  return room.players.find(p => p.clientId === clientId) || null;
}

function serializeRoom(room, clientId = '') {
  const viewer = viewerFor(room, clientId);
  const viewerRejected = new Set(room.reviewVotes?.[viewer?.id] || []);
  const reviewItems = room.status === 'review' ? room.reviewItems.map(item => ({
    id: item.id,
    playerId: item.playerId,
    playerName: item.playerName,
    type: item.type,
    label: item.label,
    answer: item.answer,
    duplicate: item.duplicate,
    startsCorrect: item.startsCorrect,
    basePoints: item.basePoints,
    rejectedByMe: viewerRejected.has(item.id)
  })) : null;
  return {
    code: room.code,
    version: Number(room.version || 0),
    meId: viewer?.id || null,
    isHost: Boolean(viewer && viewer.id === room.hostId),
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    isPrivate: room.isPrivate,
    status: room.status,
    configuredRounds: room.configuredRounds,
    startPending: room.startRequest ? { direct: room.startRequest.direct, rounds: room.startRequest.rounds } : null,
    round: room.round,
    totalRounds: room.totalRounds,
    currentChooserId: room.currentChooserId || null,
    currentChooserName: room.players.find(p => p.id === room.currentChooserId)?.name || null,
    letter: room.letter,
    usedLetters: [...(room.usedLetters || [])],
    categories: CATEGORIES,
    deadline: room.deadline,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      gender: p.gender,
      ready: p.ready,
      score: p.score,
      roundScore: p.roundScore,
      connected: isPlayerRecentlyActive(p),
      submitted: Boolean(room.submissions?.[p.id])
    })),
    reviewItems,
    reviewSubmitted: Boolean(viewer && room.reviewVotes?.[viewer.id]),
    reviewSubmittedCount: room.status === 'review' ? Object.keys(room.reviewVotes || {}).length : 0,
    rankings: room.status === 'finished' ? rankings(room) : null
  };
}

function emitRoom(room) {
  room.version = Number(room.version || 0) + 1;
  persistRooms();
  for (const p of room.players) {
    if (p.clientId) sseSend(p.clientId, 'room:state', serializeRoom(room, p.clientId));
  }
  sendRoomListToAll();
}

function roomNotice(room, message) {
  for (const p of room.players) if (p.clientId) sseSend(p.clientId, 'room:notice', message);
}

function buildPlayer(raw, clientId) {
  const gender = raw?.gender === 'female' ? 'female' : 'male';
  return {
    id: crypto.randomUUID(),
    memberToken: createMemberToken(),
    profileId: cleanText(raw?.id, 64) || '',
    name: cleanText(raw?.name, 22) || `Oyuncu${crypto.randomInt(100, 999)}`,
    gender,
    avatar: cleanText(raw?.avatar, 20) || (gender === 'female' ? 'f1' : 'm1'),
    clientId,
    ready: false,
    score: 0,
    roundScore: 0,
    lastSeen: Date.now(),
    disconnectedAt: null
  };
}

function updatePlayerProfile(player, rawProfile = {}) {
  if (!player) return;
  const gender = rawProfile?.gender === 'female' ? 'female' : rawProfile?.gender === 'male' ? 'male' : player.gender;
  const name = cleanText(rawProfile?.name, 22);
  const avatarId = cleanText(rawProfile?.avatar, 20);
  if (name) player.name = name;
  if (gender) player.gender = gender;
  if (avatarId) player.avatar = avatarId;
  player.profileId = cleanText(rawProfile?.id, 64) || player.profileId || '';
  markPlayerActive(player);
}

function getRoomForClient(clientId) {
  const code = clientRoom.get(clientId);
  return code ? rooms.get(code) : null;
}

function bindPlayerToClient(room, player, clientId) {
  // Aynı transport daha önce başka bir oyuncuya bağlıysa eski eşlemeyi bırak.
  const oldRoom = getRoomForClient(clientId);
  if (oldRoom && oldRoom.code !== room.code) clientRoom.delete(clientId);

  // Eski transport kimliğini bırak; oyuncu kimliği ve host yetkisi değişmez.
  if (player.clientId && player.clientId !== clientId) clientRoom.delete(player.clientId);
  player.clientId = clientId;
  markPlayerActive(player);
  clientRoom.set(clientId, room.code);
  return player;
}

function resolveMembership(clientId, payload = {}) {
  const mappedRoom = getRoomForClient(clientId);
  if (mappedRoom) {
    const player = mappedRoom.players.find(p => p.clientId === clientId);
    if (player) {
      markPlayerActive(player);
      return { room: mappedRoom, player };
    }
    clientRoom.delete(clientId);
  }

  const code = normalizeRoomCode(payload?.roomCode || payload?.code);
  if (!code) return null;
  const room = rooms.get(code) || recoverRoomFromDisk(code);
  if (!room) return null;

  const token = cleanText(payload?.memberToken, 128);
  let player = token ? room.players.find(p => p.memberToken === token) : null;
  if (!player) player = room.players.find(p => p.clientId === clientId);

  // Son çare kurtarma: tarayıcıdaki kalıcı profil kimliği aynı oyuncuya aitse ve o oyuncu
  // başka aktif bir bağlantıda değilse oturumu yeniden bağla. Böylece mobil tarayıcı storage
  // temizlese bile Bitti/Hazır gibi işlemler "oturum doğrulanamadı" diye kilitlenmez.
  const profileId = cleanText(payload?.profileId || payload?.profile?.id, 64);
  if (!player && profileId) {
    const matches = room.players.filter(p => p.profileId && p.profileId === profileId);
    if (matches.length === 1) player = matches[0];
  }
  if (!player) return null;

  bindPlayerToClient(room, player, clientId);
  return { room, player };
}

function removePlayer(room, player, { message = true } = {}) {
  const idx = room.players.findIndex(p => p.id === player.id);
  if (idx < 0) return;
  room.players.splice(idx, 1);
  if (player.clientId) clientRoom.delete(player.clientId);

  if (room.players.length === 0) {
    clearRoomTimer(room);
    rooms.delete(room.code);
    persistRooms();
    sendRoomListToAll();
    return;
  }

  // Host sadece gerçek ayrılma / uzun süreli oturum temizliğinde değişir; bağlantı kopmasında değişmez.
  if (room.hostId === player.id) room.hostId = room.players[0].id;

  if (room.status !== 'waiting') {
    room.turnOrder = (room.turnOrder || []).filter(id => id !== player.id);
    if (room.status === 'letter' && room.currentChooserId === player.id) room.currentChooserId = chooserForRound(room);
    if (room.submissions) delete room.submissions[player.id];
    if (room.reviewVotes) delete room.reviewVotes[player.id];
    if (room.reviewItems?.length) room.reviewItems = room.reviewItems.filter(item => item.playerId !== player.id);
    if (room.status === 'answering') {
      if (Object.keys(room.submissions).length >= room.players.length) startReview(room);
      else startLastPlayerTimer(room);
    }
    if (room.status === 'review') finalizeReviewIfReady(room);
  }

  if (message) roomNotice(room, `${player.name} odadan ayrıldı.`);
  emitRoom(room);
}

function leaveByClient(clientId) {
  const room = getRoomForClient(clientId);
  if (!room) return;
  const player = room.players.find(p => p.clientId === clientId);
  if (!player) { clientRoom.delete(clientId); return; }
  removePlayer(room, player);
}

function joinRoom(clientId, room, rawProfile, { silent = false } = {}) {
  if (room.players.length >= room.maxPlayers) throw new Error('Oda dolu.');
  if (room.status !== 'waiting') throw new Error('Bu oyun zaten başlamış.');

  const current = getRoomForClient(clientId);
  if (current) {
    const currentPlayer = current.players.find(p => p.clientId === clientId);
    if (current.code === room.code && currentPlayer) return currentPlayer;
    if (currentPlayer) removePlayer(current, currentPlayer);
  }

  const player = buildPlayer(rawProfile, clientId);
  room.players.push(player);
  clientRoom.set(clientId, room.code);
  if (!silent) {
    sseSend(clientId, 'room:joined', { code: room.code, memberToken: player.memberToken });
    roomNotice(room, `${player.name} odaya katıldı.`);
    emitRoom(room);
  }
  return player;
}

function makeRoom(clientId, raw) {
  const maxPlayers = Math.max(2, Math.min(10, Number(raw?.maxPlayers) || 6));
  const configuredRounds = Math.max(1, Math.min(MAX_ROUNDS, Number(raw?.rounds) || 3));
  const code = createRoomCode();
  const room = {
    code,
    version: 0,
    hostId: null,
    maxPlayers,
    isPrivate: Boolean(raw?.isPrivate),
    status: 'waiting',
    configuredRounds,
    startRequest: null,
    players: [],
    round: 0,
    totalRounds: 0,
    turnOrder: [],
    currentChooserId: null,
    letter: null,
    usedLetters: [],
    submissions: {},
    reviewItems: [],
    reviewVotes: {},
    deadline: null,
    timer: null,
    createdAt: Date.now()
  };
  rooms.set(code, room);
  const player = joinRoom(clientId, room, raw?.profile, { silent: true });
  room.hostId = player.id;
  sseSend(clientId, 'room:joined', { code: room.code, memberToken: player.memberToken });
  emitRoom(room);
  return { room, player };
}

function requireHost(membership) {
  if (!membership?.player || membership.player.id !== membership.room.hostId) {
    throw new Error('Bu işlem sadece oda sahibine ait.');
  }
  return membership.player;
}

function allPlayersReady(room) {
  return room.players.length >= MIN_PLAYERS && room.players.every(p => p.ready && isPlayerReadyActive(p));
}

function shuffledPlayerIds(room) {
  const ids = room.players.map(p => p.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

function normalizeGameLetter(value) {
  return cleanText(value, 2).toLocaleUpperCase('tr-TR');
}

function availableLetters(room) {
  return TURKISH_LETTERS.filter(letter => !(room.usedLetters || []).includes(letter));
}

function chooserForRound(room) {
  const alive = new Set(room.players.map(p => p.id));
  room.turnOrder = (room.turnOrder || []).filter(id => alive.has(id));
  if (!room.turnOrder.length) room.turnOrder = shuffledPlayerIds(room);
  return room.turnOrder[(Math.max(1, room.round) - 1) % room.turnOrder.length] || room.players[0]?.id || null;
}

function prepareRound(room) {
  clearRoomTimer(room);
  room.status = 'letter';
  room.letter = null;
  room.submissions = {};
  room.reviewItems = [];
  room.reviewVotes = {};
  room.players.forEach(p => { p.roundScore = 0; });
  room.currentChooserId = chooserForRound(room);
}

function chooseLetter(room, player, payload = {}) {
  if (room.status !== 'letter') throw new Error('Harf seçimi şu anda açık değil.');
  if (!player || player.id !== room.currentChooserId) throw new Error('Bu tur harf seçme sırası sende değil.');

  const available = availableLetters(room);
  if (!available.length) throw new Error('Kullanılabilir harf kalmadı.');

  let letter = payload?.random ? available[crypto.randomInt(available.length)] : normalizeGameLetter(payload?.letter);
  if (!TURKISH_LETTERS.includes(letter)) throw new Error('Geçerli bir harf seç.');
  if (!available.includes(letter)) throw new Error('Bu harf önceki bir turda seçildi. Başka bir harf seç.');

  room.letter = letter;
  room.usedLetters.push(letter);
  room.status = 'answering';
  return letter;
}

function startGame(room, roundsOverride) {
  if (room.players.length < MIN_PLAYERS) throw new Error('Oyunu başlatmak için en az 2 oyuncu gerekli.');
  if (!allPlayersReady(room)) throw new Error('Tüm oyuncular hazır olmadan oyun başlayamaz.');

  const rounds = Math.max(1, Math.min(MAX_ROUNDS, Number(roundsOverride) || room.configuredRounds || 1));
  clearRoomTimer(room);
  room.startRequest = null;
  room.players.forEach(p => { p.ready = false; p.score = 0; p.roundScore = 0; });
  room.turnOrder = shuffledPlayerIds(room);
  room.currentChooserId = null;
  room.round = 1;
  room.totalRounds = rounds;
  room.usedLetters = [];
  prepareRound(room);
}

function maybeStartPendingGame(room) {
  if (!room.startRequest || !allPlayersReady(room)) return false;
  const request = room.startRequest;
  startGame(room, request.direct ? 1 : request.rounds);
  return true;
}

function emptyAnswers() {
  return Object.fromEntries(CATEGORIES.map(c => [c.key, '']));
}

function startLastPlayerTimer(room) {
  if (!room || room.status !== 'answering' || room.players.length < 2) return false;
  const submittedCount = Object.keys(room.submissions || {}).length;
  const remaining = room.players.filter(p => !room.submissions?.[p.id]);

  // Yeni kural: ilk oyuncu "Bitti" dediği anda kalan herkes için ortak 60 saniye başlar.
  // Kimse bitirmediyse süre yok; herkes bittiyse değerlendirmeye geçilir.
  if (submittedCount < 1 || remaining.length === 0) {
    if (remaining.length === 0 && room.deadline) clearRoomTimer(room);
    return false;
  }
  if (room.deadline && room.timer) return true;

  clearRoomTimer(room);
  room.deadline = Date.now() + LAST_PLAYER_TIMEOUT_MS;
  const expectedRound = room.round;
  room.timer = setTimeout(() => {
    if (room.status !== 'answering' || room.round !== expectedRound) return;
    const stillRemaining = room.players.filter(p => !room.submissions?.[p.id]);
    for (const p of stillRemaining) room.submissions[p.id] = { ...emptyAnswers(), auto: true };
    if (room.players.length && Object.keys(room.submissions || {}).length >= room.players.length) startReview(room);
    emitRoom(room);
  }, LAST_PLAYER_TIMEOUT_MS);
  room.timer.unref?.();
  return true;
}

function startReview(room) {
  clearRoomTimer(room);
  room.status = 'review';
  room.reviewVotes = {};
  const countsByType = Object.fromEntries(CATEGORIES.map(c => [c.key, new Map()]));

  for (const p of room.players) {
    const sub = room.submissions[p.id] || emptyAnswers();
    for (const category of CATEGORIES) {
      const normalized = normalizeAnswer(sub[category.key]);
      if (normalized) countsByType[category.key].set(normalized, (countsByType[category.key].get(normalized) || 0) + 1);
    }
  }

  room.reviewItems = [];
  for (const p of room.players) {
    const sub = room.submissions[p.id] || emptyAnswers();
    for (const category of CATEGORIES) {
      const answer = cleanText(sub[category.key], 36);
      const normalized = normalizeAnswer(answer);
      const count = countsByType[category.key].get(normalized) || 0;
      const startsCorrect = normalized ? normalized.toLocaleUpperCase('tr-TR').startsWith(room.letter) : false;
      const basePoints = !normalized ? 0 : (count > 1 ? 5 : 10);
      room.reviewItems.push({
        id: crypto.randomUUID(),
        playerId: p.id,
        playerName: p.name,
        type: category.key,
        label: category.label,
        answer,
        duplicate: count > 1,
        startsCorrect,
        basePoints,
        rejected: false,
        awarded: 0
      });
    }
  }
}

function finalizeReviewIfReady(room) {
  if (room.status !== 'review') return false;
  const submittedPlayers = Object.keys(room.reviewVotes || {});
  if (!room.players.every(p => submittedPlayers.includes(p.id))) return false;

  for (const item of room.reviewItems) {
    const eligible = room.players.filter(p => p.id !== item.playerId).map(p => p.id);
    const unanimousReject = eligible.length > 0 && eligible.every(id => (room.reviewVotes[id] || []).includes(item.id));
    const structurallyInvalid = !item.answer || !item.startsCorrect;
    item.rejected = unanimousReject || structurallyInvalid;
    item.awarded = !item.answer ? 0 : (item.rejected ? -5 : item.basePoints);
    const owner = room.players.find(p => p.id === item.playerId);
    if (owner) { owner.roundScore += item.awarded; owner.score += item.awarded; }
  }

  if (room.round >= room.totalRounds) {
    room.status = 'finished';
    room.currentChooserId = null;
  } else {
    room.round++;
    prepareRound(room);
  }
  return true;
}

function stateResult(room, clientId, extra = {}) {
  const viewer = room.players.find(p => p.clientId === clientId);
  return { ok: true, code: room.code, memberToken: viewer?.memberToken || extra.memberToken || undefined, state: serializeRoom(room, clientId), ...extra };
}

const actions = {
  'room:sync': (clientId, payload) => {
    const membership = resolveMembership(clientId, payload);
    if (!membership) throw new Error('Oda oturumu doğrulanamadı. Oda kodunu veya oturumunu kontrol et.');
    const { room, player } = membership;
    player.lastSeen = Date.now();
    // HTTP sync cevabı yeterli. Burada ayrıca SSE state göndermek formu gereksiz yere yeniden render edip
    // mobil klavyeyi kapatıyordu. Gerçek değişiklikler emitRoom() üzerinden canlı yayınlanır.
    return stateResult(room, clientId, { memberToken: player.memberToken });
  },

  'room:update-profile': (clientId, payload) => {
    const membership = resolveMembership(clientId, payload);
    if (!membership) throw new Error('Aktif oda oturumu bulunamadı.');
    updatePlayerProfile(membership.player, payload?.profile || {});
    emitRoom(membership.room);
    return stateResult(membership.room, clientId, { memberToken: membership.player.memberToken });
  },

  'rooms:refresh': clientId => {
    sseSend(clientId, 'rooms:list', roomList());
    return { ok: true };
  },

  'room:create': (clientId, payload) => {
    const { room, player } = makeRoom(clientId, payload);
    return stateResult(room, clientId, { memberToken: player.memberToken });
  },

  'room:join': (clientId, payload) => {
    const code = normalizeRoomCode(payload?.code || payload?.roomCode);
    if (code.length !== 5) throw new Error('Geçerli 5 haneli oda kodunu gir.');
    let room = rooms.get(code) || recoverRoomFromDisk(code);
    if (!room) throw new Error(`Oda ${code} bulunamadı. Kodun doğru olduğundan emin ol.`);

    // Aynı oyuncu refresh/yeni sekme sonrası kodu tekrar girerse duplicate yaratma, mevcut üyeliği geri bağla.
    const token = cleanText(payload?.memberToken, 128);
    const profileId = cleanText(payload?.profileId || payload?.profile?.id, 64);
    let player = token ? room.players.find(p => p.memberToken === token) : null;
    if (!player && profileId) {
      const matches = room.players.filter(p => p.profileId && p.profileId === profileId);
      if (matches.length === 1) player = matches[0];
    }
    if (player) {
      bindPlayerToClient(room, player, clientId);
      updatePlayerProfile(player, payload?.profile || {});
      emitRoom(room);
      return stateResult(room, clientId, { memberToken: player.memberToken, resumed: true });
    }

    player = joinRoom(clientId, room, payload?.profile);
    return stateResult(room, clientId, { memberToken: player.memberToken });
  },

  'room:quick-play': (clientId, payload) => {
    const current = resolveMembership(clientId, payload);
    if (current?.room?.status === 'waiting') return stateResult(current.room, clientId, { resumed: true, memberToken: current.player.memberToken });

    let room = [...rooms.values()]
      .filter(r => {
        const host = r.players.find(p => p.id === r.hostId);
        return !r.isPrivate && r.status === 'waiting' && r.players.length < r.maxPlayers && isPlayerRecentlyActive(host);
      })
      .sort((a, b) => b.players.length - a.players.length)[0];

    if (!room) {
      const created = makeRoom(clientId, { profile: payload?.profile, maxPlayers: 6, isPrivate: false, rounds: 3 });
      return stateResult(created.room, clientId, { memberToken: created.player.memberToken });
    }
    const player = joinRoom(clientId, room, payload?.profile);
    return stateResult(room, clientId, { memberToken: player.memberToken });
  },

  'room:quick-join': (clientId, payload) => {
    const current = resolveMembership(clientId, payload);
    if (current?.room?.status === 'waiting') return stateResult(current.room, clientId, { resumed: true, memberToken: current.player.memberToken });

    const room = [...rooms.values()]
      .filter(r => {
        const host = r.players.find(p => p.id === r.hostId);
        return !r.isPrivate && r.status === 'waiting' && r.players.length < r.maxPlayers && isPlayerRecentlyActive(host);
      })
      .sort((a, b) => b.players.length - a.players.length)[0];
    if (!room) throw new Error('Şu an katılabileceğin açık bir oda yok. Hızlı Oyna ile yeni eşleşme başlatabilirsin.');
    const player = joinRoom(clientId, room, payload?.profile);
    return stateResult(room, clientId, { memberToken: player.memberToken });
  },

  'room:ready': (clientId, payload) => {
    const membership = resolveMembership(clientId, payload);
    if (!membership || membership.room.status !== 'waiting') throw new Error('Hazır durumu şu anda değiştirilemez.');
    const desired = typeof payload?.ready === 'boolean' ? payload.ready : !membership.player.ready;
    const changed = membership.player.ready !== desired;
    membership.player.ready = desired;
    membership.player.lastSeen = Date.now();
    const autoStarted = maybeStartPendingGame(membership.room);
    if (changed || autoStarted) emitRoom(membership.room);
    return stateResult(membership.room, clientId, { ready: membership.player.ready, autoStarted });
  },

  'room:kick': (clientId, payload) => {
    const membership = resolveMembership(clientId, payload);
    if (!membership || membership.room.status !== 'waiting') throw new Error('Oyuncu yalnızca lobide atılabilir.');
    const host = requireHost(membership);
    const targetId = cleanText(payload?.playerId, 64);
    if (targetId === host.id) throw new Error('Kendini atamazsın.');
    const target = membership.room.players.find(p => p.id === targetId);
    if (!target) throw new Error('Oyuncu bulunamadı.');
    if (target.clientId) sseSend(target.clientId, 'room:kicked', {});
    removePlayer(membership.room, target);
    return { ok: true };
  },

  'room:set-rounds': (clientId, payload) => {
    const membership = resolveMembership(clientId, payload);
    if (!membership || membership.room.status !== 'waiting') throw new Error('Tur sayısı yalnızca lobide değiştirilebilir.');
    requireHost(membership);
    membership.room.configuredRounds = Math.max(1, Math.min(MAX_ROUNDS, Number(payload?.rounds) || 1));
    if (membership.room.startRequest && !membership.room.startRequest.direct) membership.room.startRequest.rounds = membership.room.configuredRounds;
    emitRoom(membership.room);
    return stateResult(membership.room, clientId, { rounds: membership.room.configuredRounds });
  },

  'room:start': (clientId, payload) => {
    const membership = resolveMembership(clientId, payload);
    if (!membership) throw new Error('Oda oturumu doğrulanamadı.');
    requireHost(membership);
    const room = membership.room;
    // Ağ tekrar denemesi / çift tıklama aynı başlatma isteğini yeniden gönderirse hata verme.
    // Mevcut oyun state'ini dön; istemci doğru ekrana anında yönlensin.
    if (room.status !== 'waiting') return stateResult(room, clientId, { alreadyStarted: true });
    if (room.players.length < MIN_PLAYERS) throw new Error('En az 2 oyuncu gerekli.');
    const direct = Boolean(payload?.direct);

    // Host başlatmayı ister; hazır olmayan varsa istek beklemeye alınır ve son kişi hazır olduğunda otomatik başlar.
    if (!allPlayersReady(room)) {
      room.startRequest = { direct, rounds: direct ? 1 : room.configuredRounds, requestedAt: Date.now() };
      emitRoom(room);
      return stateResult(room, clientId, { pending: true, rounds: room.startRequest.rounds });
    }

    startGame(room, direct ? 1 : room.configuredRounds);
    emitRoom(room);
    return stateResult(room, clientId, { pending: false, rounds: room.totalRounds });
  },

  'game:choose-letter': (clientId, payload) => {
    const membership = resolveMembership(clientId, payload);
    if (!membership) throw new Error('Oyun oturumu doğrulanamadı.');
    const { room, player } = membership;
    if (room.status !== 'letter') return stateResult(room, clientId, { alreadyChosen: Boolean(room.letter), letter: room.letter || null });
    const letter = chooseLetter(room, player, payload);
    emitRoom(room);
    return stateResult(room, clientId, { letter });
  },

  'game:submit': (clientId, payload) => {
    const membership = resolveMembership(clientId, payload);
    if (!membership) throw new Error('Oyun oturumu doğrulanamadı.');
    const { room, player } = membership;
    if (room.status !== 'answering') {
      return stateResult(room, clientId, { alreadyAdvanced: true });
    }
    if (room.submissions[player.id]) return stateResult(room, clientId, { alreadySubmitted: true });
    const rawAnswers = payload?.answers && typeof payload.answers === 'object' ? payload.answers : payload || {};
    const answers = Object.fromEntries(CATEGORIES.map(c => [c.key, cleanText(rawAnswers[c.key], 36)]));
    room.submissions[player.id] = { ...answers, auto: false };
    const submitted = Object.keys(room.submissions).length;
    if (submitted >= room.players.length) startReview(room);
    else startLastPlayerTimer(room);
    emitRoom(room);
    return stateResult(room, clientId);
  },

  'game:review-submit': (clientId, payload) => {
    const membership = resolveMembership(clientId, payload);
    if (!membership) throw new Error('Oyun oturumu doğrulanamadı.');
    const { room, player } = membership;
    if (room.status !== 'review') return stateResult(room, clientId, { alreadyAdvanced: true });
    if (room.reviewVotes[player.id]) return stateResult(room, clientId, { alreadySubmitted: true });
    const allowed = new Set(room.reviewItems.filter(item => item.playerId !== player.id).map(item => item.id));
    const rejected = Array.isArray(payload?.rejectedIds) ? payload.rejectedIds.filter(id => allowed.has(id)).slice(0, room.reviewItems.length) : [];
    room.reviewVotes[player.id] = [...new Set(rejected)];
    const advanced = finalizeReviewIfReady(room);
    emitRoom(room);
    return stateResult(room, clientId, { advanced });
  },

  'game:replay-now': (clientId, payload) => {
    const membership = resolveMembership(clientId, payload);
    if (!membership || membership.room.status !== 'finished') throw new Error('Tekrar oynama şu anda kullanılamaz.');
    requireHost(membership);
    membership.room.players.forEach(p => { p.ready = true; });
    startGame(membership.room, membership.room.totalRounds || membership.room.configuredRounds);
    emitRoom(membership.room);
    return stateResult(membership.room, clientId);
  },

  'game:back-lobby': (clientId, payload) => {
    const membership = resolveMembership(clientId, payload);
    if (!membership) throw new Error('Oda bulunamadı.');
    requireHost(membership);
    const room = membership.room;
    clearRoomTimer(room);
    Object.assign(room, {
      status: 'waiting', round: 0, totalRounds: 0, turnOrder: [], currentChooserId: null,
      letter: null, usedLetters: [], submissions: {}, reviewItems: [], reviewVotes: {}, startRequest: null
    });
    room.players.forEach(p => { p.ready = false; p.score = 0; p.roundScore = 0; });
    emitRoom(room);
    return stateResult(room, clientId);
  },

  'room:leave': (clientId, payload) => {
    const membership = resolveMembership(clientId, payload);
    if (membership) removePlayer(membership.room, membership.player);
    else leaveByClient(clientId);
    return { ok: true };
  }
};

function serveStatic(req, res, url) {
  const filePath = url.pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, decodeURIComponent(url.pathname));
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'Forbidden' });
  fs.stat(normalized, (err, stat) => {
    if (err || !stat.isFile()) return json(res, 404, { error: 'Not found' });
    const ext = path.extname(normalized).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
      '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon'
    };
    const cacheControl = ['.html','.js','.css'].includes(ext) ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream', 'cache-control': cacheControl, 'x-content-type-options': 'nosniff' });
    fs.createReadStream(normalized).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, { discordInviteUrl: DISCORD_INVITE_URL });
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, rooms: rooms.size, clients: clients.size, memberIdleTtlMs: MEMBER_IDLE_TTL_MS, disconnectedMemberTtlMs: DISCONNECTED_MEMBER_TTL_MS, readyDisconnectGraceMs: READY_DISCONNECT_GRACE_MS, lastPlayerTimeoutMs: LAST_PLAYER_TIMEOUT_MS });

  if (req.method === 'GET' && url.pathname === '/api/events') {
    const clientId = cleanText(url.searchParams.get('clientId'), 80);
    if (!clientId) { res.writeHead(400); return res.end('clientId required'); }

    if (clients.has(clientId)) { try { clients.get(clientId).end(); } catch {} }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
      'access-control-allow-origin': '*'
    });
    res.write(': connected\n\n');
    clients.set(clientId, res);

    const roomCode = normalizeRoomCode(url.searchParams.get('roomCode'));
    const memberToken = cleanText(url.searchParams.get('memberToken'), 128);
    const membership = resolveMembership(clientId, { roomCode, memberToken });
    if (membership) markPlayerActive(membership.player);

    broadcastPresence();
    sseSend(clientId, 'rooms:list', roomList());
    if (membership) sseSend(clientId, 'room:state', serializeRoom(membership.room, clientId));

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n');
    }, 15000);

    res.on('close', () => {
      clearInterval(heartbeat);
      if (clients.get(clientId) === res) {
        clients.delete(clientId);
        const activeRoom = getRoomForClient(clientId);
        const player = activeRoom?.players.find(p => p.clientId === clientId);
        if (player && activeRoom) scheduleDisconnectedPlayer(activeRoom, player);
        // Refresh/VPN için kısa tolerans var; gerçek kopuşlarda hayalet üyelik otomatik temizlenir.
        broadcastPresence();
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/action') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 100000) req.destroy();
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const clientId = cleanText(parsed.clientId, 80);
        const event = cleanText(parsed.event, 60);
        if (!clientId || !event) return json(res, 400, { ok: false, error: 'Eksik istek.' });
        const fn = actions[event];
        if (!fn) return json(res, 404, { ok: false, error: 'Bilinmeyen işlem.' });
        const result = fn(clientId, parsed.payload || {});
        json(res, 200, result || { ok: true });
      } catch (err) {
        json(res, 200, { ok: false, error: err?.message || 'Bir şey ters gitti.' });
      }
    });
    return;
  }

  if (req.method === 'GET') return serveStatic(req, res, url);
  res.writeHead(405);
  res.end('Method Not Allowed');
});

// Presence tek kaynaktan hesaplanır: SSE bağlıysa online, SSE yoksa son API aktivitesine göre kısa tolerans.
// Böylece refresh/VPN oyuncuyu düşürmez; gerçekten kapanmış sekme ise hayalet oyuncu olarak odada kalmaz.
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    if (!rooms.has(room.code)) continue;
    for (const player of [...room.players]) {
      if (isPlayerConnected(player)) continue;
      const idle = now - Number(player.lastSeen || 0);
      if (room.status === 'waiting' && player.ready && idle >= READY_DISCONNECT_GRACE_MS) {
        player.ready = false;
        emitRoom(room);
      }
      if (idle >= DISCONNECTED_MEMBER_TTL_MS && rooms.has(room.code) && room.players.includes(player)) {
        removePlayer(room, player, { message: false });
      }
    }
  }
}, 5_000);
cleanupTimer.unref?.();

// Sunucu yeniden başlarsa oda kodları anında kaybolmasın.
for (const raw of readPersistedRooms()) {
  const room = reviveRoom(raw);
  if (!room) continue;
  rooms.set(room.code, room);
  // Devam eden cevap turunda aktif bir deadline varsa kalan süreyi yeniden kur.
  if (room.status === 'answering' && room.deadline) {
    const remainingMs = Number(room.deadline) - Date.now();
    if (remainingMs > 0) {
      room.timer = setTimeout(() => {
        if (room.status !== 'answering') return;
        for (const p of room.players.filter(p => !room.submissions?.[p.id])) room.submissions[p.id] = { ...emptyAnswers(), auto: true };
        startReview(room);
        emitRoom(room);
      }, remainingMs);
      room.timer.unref?.();
    } else {
      for (const p of room.players.filter(p => !room.submissions?.[p.id])) room.submissions[p.id] = { ...emptyAnswers(), auto: true };
      startReview(room);
    }
  }
}

server.listen(PORT, '0.0.0.0', () => console.log(`İsim Şehir Online → http://localhost:${PORT}`));
