import asyncio
import json
import os
import random
import time
from typing import Dict, List, Optional, Set
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

app = FastAPI(title="BombRush Multiplayer")

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

# Load Dictionary and Prompts
with open(os.path.join(BASE_DIR, "words.json"), "r", encoding="utf-8") as f:
    WORDS_LIST = json.load(f)
    VALID_WORDS_SET = set(WORDS_LIST)

with open(os.path.join(BASE_DIR, "prompts.json"), "r", encoding="utf-8") as f:
    PROMPTS_DATA = json.load(f)
    ALL_PROMPTS = (
        PROMPTS_DATA.get("easy", []) +
        PROMPTS_DATA.get("medium", []) +
        PROMPTS_DATA.get("hard", [])
    )
    if not ALL_PROMPTS:
        ALL_PROMPTS = ["TH", "IN", "ST", "ER", "RE", "AN", "ON", "AT", "OR", "TE", "AR", "AL", "ES", "CO", "MA", "LI"]


class Player:
    def __init__(self, player_id: str, name: str, avatar: str, ws: WebSocket):
        self.id = player_id
        self.name = name
        self.avatar = avatar
        self.ws = ws
        self.lives = 3
        self.score = 0
        self.is_alive = True
        self.is_connected = True
        self.words_submitted: List[str] = []

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "avatar": self.avatar,
            "lives": self.lives,
            "score": self.score,
            "is_alive": self.is_alive,
            "is_connected": self.is_connected
        }


class Room:
    def __init__(self, code: str, host_id: str):
        self.code = code
        self.host_id = host_id
        self.players: Dict[str, Player] = {}
        self.state: str = "LOBBY"  # LOBBY, PLAYING, GAME_OVER
        self.turn_order: List[str] = []
        self.current_turn_index: int = 0
        self.current_prompt: str = ""
        self.used_words: Set[str] = set()
        self.round_number: int = 1
        self.initial_time_limit: float = 8.0
        self.current_time_limit: float = 8.0
        self.time_remaining: float = 8.0
        self.timer_task: Optional[asyncio.Task] = None
        self.longest_word: str = ""
        self.longest_word_player: str = ""
        self.total_words_count: int = 0
        self.lock = asyncio.Lock()

    def get_player(self, player_id: str) -> Optional[Player]:
        return self.players.get(player_id)

    def get_alive_players(self) -> List[Player]:
        return [p for p in self.players.values() if p.is_alive and p.is_connected]

    def to_dict(self):
        return {
            "code": self.code,
            "host_id": self.host_id,
            "state": self.state,
            "players": [p.to_dict() for p in self.players.values()],
            "round_number": self.round_number,
            "turn_order": self.turn_order,
            "active_player_id": self.get_active_player_id(),
            "current_prompt": self.current_prompt,
            "time_limit": self.current_time_limit,
            "time_remaining": self.time_remaining,
            "used_words_count": len(self.used_words),
            "stats": {
                "longest_word": self.longest_word,
                "longest_word_player": self.longest_word_player,
                "total_words": self.total_words_count
            }
        }

    def get_active_player_id(self) -> Optional[str]:
        if not self.turn_order or self.current_turn_index >= len(self.turn_order):
            return None
        return self.turn_order[self.current_turn_index]

    async def broadcast(self, message: dict):
        dead_players = []
        for pid, player in self.players.items():
            if player.is_connected and player.ws:
                try:
                    await player.ws.send_json(message)
                except Exception:
                    dead_players.append(pid)
        for pid in dead_players:
            if pid in self.players:
                self.players[pid].is_connected = False

    def select_next_prompt(self) -> str:
        # Increase difficulty slightly as total words increase
        if self.total_words_count < 10 and PROMPTS_DATA.get("easy"):
            pool = PROMPTS_DATA["easy"]
        elif self.total_words_count < 25 and PROMPTS_DATA.get("medium"):
            pool = PROMPTS_DATA["medium"]
        else:
            pool = ALL_PROMPTS
        prompt = random.choice(pool)
        self.current_prompt = prompt.upper()
        return self.current_prompt

    def advance_turn(self):
        alive_ids = [p.id for p in self.get_alive_players()]
        if not alive_ids:
            return None

        # Re-filter turn order to alive players only
        self.turn_order = [pid for pid in self.turn_order if pid in alive_ids]
        if not self.turn_order:
            self.turn_order = alive_ids
            self.current_turn_index = 0
        else:
            self.current_turn_index = (self.current_turn_index + 1) % len(self.turn_order)

        # Slightly reduce turn time for increasing adrenaline (min 4.5 seconds)
        if self.current_time_limit > 4.5:
            self.current_time_limit = max(4.5, self.current_time_limit - 0.15)

        self.time_remaining = self.current_time_limit
        return self.get_active_player_id()


class GameManager:
    def __init__(self):
        self.rooms: Dict[str, Room] = {}

    def generate_room_code(self) -> str:
        chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        for _ in range(100):
            code = "".join(random.choice(chars) for _ in range(4))
            if code not in self.rooms:
                return code
        return f"ROOM{random.randint(100, 999)}"

    def get_room(self, code: str) -> Optional[Room]:
        return self.rooms.get(code.upper())

    def create_room(self, host_id: str) -> Room:
        code = self.generate_room_code()
        room = Room(code, host_id)
        self.rooms[code] = room
        return room

    def cleanup_empty_rooms(self):
        to_delete = []
        for code, room in self.rooms.items():
            connected = [p for p in room.players.values() if p.is_connected]
            if not connected:
                if room.timer_task and not room.timer_task.done():
                    room.timer_task.cancel()
                to_delete.append(code)
        for code in to_delete:
            del self.rooms[code]


game_manager = GameManager()


# --- Game Loop & Timer ---
async def start_turn_timer(room: Room):
    if room.timer_task and not room.timer_task.done():
        room.timer_task.cancel()

    async def timer_countdown():
        try:
            tick_interval = 0.2
            while room.time_remaining > 0:
                await asyncio.sleep(tick_interval)
                room.time_remaining = max(0.0, round(room.time_remaining - tick_interval, 1))

                # Broadcast tick updates every 0.6s or when critically low
                if round(room.time_remaining * 10) % 6 == 0 or room.time_remaining <= 2.0:
                    await room.broadcast({
                        "type": "timer_tick",
                        "time_remaining": room.time_remaining,
                        "time_limit": room.current_time_limit,
                        "active_player_id": room.get_active_player_id()
                    })

            # Time ran out! Bomb explodes on the active player!
            async with room.lock:
                await handle_bomb_explosion(room)

        except asyncio.CancelledError:
            pass

    room.timer_task = asyncio.create_task(timer_countdown())


async def handle_bomb_explosion(room: Room):
    active_id = room.get_active_player_id()
    if not active_id or active_id not in room.players:
        return

    player = room.players[active_id]
    player.lives -= 1

    exploded_event = {
        "type": "bomb_exploded",
        "player_id": player.id,
        "player_name": player.name,
        "lives_left": player.lives,
        "prompt": room.current_prompt
    }
    await room.broadcast(exploded_event)

    # Check elimination
    if player.lives <= 0:
        player.is_alive = False
        await room.broadcast({
            "type": "player_eliminated",
            "player_id": player.id,
            "player_name": player.name
        })

    # Check remaining alive players
    alive_players = room.get_alive_players()
    if len(alive_players) <= 1 and len(room.players) >= 2:
        # Game over!
        winner = alive_players[0] if alive_players else player
        room.state = "GAME_OVER"
        if room.timer_task and not room.timer_task.done():
            room.timer_task.cancel()

        await room.broadcast({
            "type": "game_over",
            "winner": winner.to_dict(),
            "players": [p.to_dict() for p in room.players.values()],
            "stats": {
                "longest_word": room.longest_word,
                "longest_word_player": room.longest_word_player,
                "total_words": room.total_words_count
            }
        })
        return

    # Game continues: advance turn and choose new prompt
    room.advance_turn()
    room.select_next_prompt()

    await room.broadcast({
        "type": "turn_start",
        "active_player_id": room.get_active_player_id(),
        "prompt": room.current_prompt,
        "time_limit": room.current_time_limit,
        "time_remaining": room.current_time_limit,
        "turn_order": room.turn_order,
        "players": [p.to_dict() for p in room.players.values()]
    })

    await start_turn_timer(room)


# --- REST API Endpoints ---
@app.get("/")
async def get_index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/api/room/check/{code}")
async def check_room(code: str):
    room = game_manager.get_room(code)
    if not room:
        return JSONResponse({"exists": False}, status_code=404)
    return {
        "exists": True,
        "code": room.code,
        "state": room.state,
        "player_count": len([p for p in room.players.values() if p.is_connected])
    }


@app.post("/api/room/create")
async def create_room_api():
    room = game_manager.create_room(host_id="")
    return {"code": room.code}


# --- WebSocket Handler ---
@app.websocket("/ws/{room_code}/{player_id}")
async def websocket_endpoint(websocket: WebSocket, room_code: str, player_id: str):
    await websocket.accept()
    room = game_manager.get_room(room_code)

    if not room:
        room = Room(room_code.upper(), host_id=player_id)
        game_manager.rooms[room_code.upper()] = room

    player = room.get_player(player_id)

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            # 1. Player Joins with Profile
            if msg_type == "join":
                name = (data.get("name") or "Player").strip()[:16]
                avatar = data.get("avatar") or "😎"

                if player:
                    player.name = name
                    player.avatar = avatar
                    player.ws = websocket
                    player.is_connected = True
                else:
                    player = Player(player_id, name, avatar, websocket)
                    room.players[player_id] = player

                # First player becomes host
                if not room.host_id or room.host_id not in room.players or not room.players[room.host_id].is_connected:
                    room.host_id = player_id

                # Broadcast room update
                await room.broadcast({
                    "type": "room_state",
                    "room": room.to_dict()
                })

            # 2. Host Updates Game Settings
            elif msg_type == "update_settings":
                if player_id == room.host_id and room.state == "LOBBY":
                    time_limit = float(data.get("time_limit", 8.0))
                    lives = int(data.get("lives", 3))
                    room.initial_time_limit = time_limit
                    room.current_time_limit = time_limit
                    for p in room.players.values():
                        p.lives = lives
                    await room.broadcast({
                        "type": "settings_updated",
                        "time_limit": time_limit,
                        "lives": lives
                    })

            # 3. Host Starts Game
            elif msg_type == "start_game":
                if player_id == room.host_id:
                    connected_players = [p for p in room.players.values() if p.is_connected]
                    if len(connected_players) >= 1:  # Allow 1+ for solo testing or 2+ for multiplayer
                        async with room.lock:
                            room.state = "PLAYING"
                            room.used_words.clear()
                            room.round_number = 1
                            room.total_words_count = 0
                            room.longest_word = ""
                            room.longest_word_player = ""
                            room.current_time_limit = room.initial_time_limit

                            # Reset players
                            initial_lives = int(data.get("lives", 3))
                            for p in room.players.values():
                                p.lives = initial_lives
                                p.score = 0
                                p.is_alive = True
                                p.words_submitted.clear()

                            # Set turn order (randomize for fun!)
                            alive_ids = [p.id for p in connected_players]
                            random.shuffle(alive_ids)
                            room.turn_order = alive_ids
                            room.current_turn_index = 0

                            # First prompt
                            room.select_next_prompt()
                            room.time_remaining = room.current_time_limit

                            await room.broadcast({
                                "type": "game_started",
                                "room": room.to_dict()
                            })

                            await start_turn_timer(room)

            # 4. Word Submission
            elif msg_type == "submit_word":
                if room.state != "PLAYING":
                    continue

                if player_id != room.get_active_player_id():
                    await websocket.send_json({
                        "type": "word_rejected",
                        "reason": "Not your turn!"
                    })
                    continue

                word = (data.get("word") or "").strip().upper()
                prompt = room.current_prompt.upper()

                # Validation 1: Contains prompt
                if prompt not in word:
                    await websocket.send_json({
                        "type": "word_rejected",
                        "word": word,
                        "reason": f"Must contain '{prompt}'"
                    })
                    continue

                # Validation 2: Already used
                if word in room.used_words:
                    await websocket.send_json({
                        "type": "word_rejected",
                        "word": word,
                        "reason": f"'{word}' was already used!"
                    })
                    continue

                # Validation 3: In official English dictionary
                if word not in VALID_WORDS_SET:
                    await websocket.send_json({
                        "type": "word_rejected",
                        "word": word,
                        "reason": f"'{word}' is not in dictionary"
                    })
                    continue

                # Word is VALID!
                async with room.lock:
                    room.used_words.add(word)
                    player.words_submitted.append(word)
                    room.total_words_count += 1

                    # Track longest word
                    if len(word) > len(room.longest_word):
                        room.longest_word = word
                        room.longest_word_player = player.name

                    # Calculate score: base (100) + length bonus (20 per letter) + speed bonus (up to 100)
                    speed_bonus = int((room.time_remaining / room.current_time_limit) * 100)
                    points = 100 + (len(word) * 20) + speed_bonus
                    player.score += points

                    # Stop current timer immediately
                    if room.timer_task and not room.timer_task.done():
                        room.timer_task.cancel()

                    await room.broadcast({
                        "type": "word_accepted",
                        "player_id": player.id,
                        "player_name": player.name,
                        "word": word,
                        "prompt": prompt,
                        "points": points,
                        "player_score": player.score,
                        "used_words_count": len(room.used_words)
                    })

                    # Advance turn & pick new prompt
                    room.advance_turn()
                    room.select_next_prompt()

                    await room.broadcast({
                        "type": "turn_start",
                        "active_player_id": room.get_active_player_id(),
                        "prompt": room.current_prompt,
                        "time_limit": room.current_time_limit,
                        "time_remaining": room.current_time_limit,
                        "turn_order": room.turn_order,
                        "players": [p.to_dict() for p in room.players.values()]
                    })

                    await start_turn_timer(room)

            # 5. Quick Reaction / Emoji Broadcast
            elif msg_type == "reaction":
                emoji = data.get("emoji", "🔥")
                await room.broadcast({
                    "type": "reaction_broadcast",
                    "player_id": player_id,
                    "player_name": player.name if player else "Player",
                    "emoji": emoji
                })

            # 6. Play Again / Reset to Lobby
            elif msg_type == "play_again":
                if player_id == room.host_id or room.state == "GAME_OVER":
                    if room.timer_task and not room.timer_task.done():
                        room.timer_task.cancel()
                    room.state = "LOBBY"
                    room.used_words.clear()
                    room.round_number = 1
                    for p in room.players.values():
                        p.lives = 3
                        p.score = 0
                        p.is_alive = True
                        p.words_submitted.clear()
                    await room.broadcast({
                        "type": "room_state",
                        "room": room.to_dict()
                    })

    except WebSocketDisconnect:
        if player:
            player.is_connected = False
            # If active player disconnected during their turn, advance turn
            if room.state == "PLAYING" and room.get_active_player_id() == player_id:
                async with room.lock:
                    room.advance_turn()
                    alive = room.get_alive_players()
                    if len(alive) <= 1 and len(room.players) >= 2:
                        room.state = "GAME_OVER"
                        winner = alive[0] if alive else player
                        if room.timer_task and not room.timer_task.done():
                            room.timer_task.cancel()
                        await room.broadcast({
                            "type": "game_over",
                            "winner": winner.to_dict(),
                            "players": [p.to_dict() for p in room.players.values()]
                        })
                    else:
                        room.select_next_prompt()
                        await room.broadcast({
                            "type": "turn_start",
                            "active_player_id": room.get_active_player_id(),
                            "prompt": room.current_prompt,
                            "time_limit": room.current_time_limit,
                            "time_remaining": room.current_time_limit,
                            "turn_order": room.turn_order,
                            "players": [p.to_dict() for p in room.players.values()]
                        })
                        await start_turn_timer(room)

            # Reassign host if host left
            if room.host_id == player_id:
                connected = [p for p in room.players.values() if p.is_connected]
                if connected:
                    room.host_id = connected[0].id

            await room.broadcast({
                "type": "player_left",
                "player_id": player_id,
                "player_name": player.name,
                "room": room.to_dict()
            })

        game_manager.cleanup_empty_rooms()


# Mount static directory for JS, CSS, Assets
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
