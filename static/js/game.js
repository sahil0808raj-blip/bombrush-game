// BombRush Multiplayer Client Script
(function() {
    // --- State Variables ---
    let socket = null;
    let playerId = localStorage.getItem('bombrush_player_id') || ('p_' + Math.random().toString(36).substring(2, 9));
    localStorage.setItem('bombrush_player_id', playerId);

    let currentRoomCode = null;
    let isHost = false;
    let isMyTurn = false;
    let selectedAvatar = '😎';
    let currentPrompt = '';
    let currentLimit = 8.0;
    let remainingTime = 8.0;
    let timerAnimFrame = null;
    let lastTickTime = Date.now();
    let currentLives = 3;
    let currentTurnTimer = 8.0;

    // --- DOM Elements ---
    const screens = {
        home: document.getElementById('screenHome'),
        lobby: document.getElementById('screenLobby'),
        game: document.getElementById('screenGame')
    };

    // Home inputs
    const inputPlayerName = document.getElementById('inputPlayerName');
    const inputRoomCode = document.getElementById('inputRoomCode');
    const btnCreateRoom = document.getElementById('btnCreateRoom');
    const btnJoinRoom = document.getElementById('btnJoinRoom');
    const avatarGrid = document.getElementById('avatarGrid');

    // Lobby inputs
    const lobbyRoomCode = document.getElementById('lobbyRoomCode');
    const lobbyPlayerCount = document.getElementById('lobbyPlayerCount');
    const lobbyPlayersGrid = document.getElementById('lobbyPlayersGrid');
    const btnCopyCode = document.getElementById('btnCopyCode');
    const copyText = document.getElementById('copyText');
    const copyIcon = document.getElementById('copyIcon');
    const btnStartGame = document.getElementById('btnStartGame');
    const waitingForHostText = document.getElementById('waitingForHostText');
    const hostSettingsBox = document.getElementById('hostSettingsBox');

    // Game Arena elements
    const gamePlayersStrip = document.getElementById('gamePlayersStrip');
    const turnBanner = document.getElementById('turnBanner');
    const turnBannerEmoji = document.getElementById('turnBannerEmoji');
    const turnBannerText = document.getElementById('turnBannerText');
    const promptDisplay = document.getElementById('promptDisplay');
    const timerCircleProgress = document.getElementById('timerCircleProgress');
    const timerSecondsText = document.getElementById('timerSecondsText');
    const bombGraphic = document.getElementById('bombGraphic');
    const wordInput = document.getElementById('wordInput');
    const btnSubmitWord = document.getElementById('btnSubmitWord');
    const inputFeedback = document.getElementById('inputFeedback');
    const wordsHistory = document.getElementById('wordsHistory');

    // Modals
    const modalGameOver = document.getElementById('modalGameOver');
    const winnerAvatar = document.getElementById('winnerAvatar');
    const winnerName = document.getElementById('winnerName');
    const winnerScore = document.getElementById('winnerScore');
    const statLongestWord = document.getElementById('statLongestWord');
    const statTotalWords = document.getElementById('statTotalWords');
    const btnPlayAgain = document.getElementById('btnPlayAgain');

    const modalRules = document.getElementById('modalRules');
    const btnRules = document.getElementById('btnRules');
    const btnCloseRules = document.getElementById('btnCloseRules');
    const btnMute = document.getElementById('btnMute');

    // Restore saved nickname
    const savedName = localStorage.getItem('bombrush_player_name');
    if (savedName) inputPlayerName.value = savedName;

    // Check URL search parameters (e.g. ?room=ABCD)
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl) {
        inputRoomCode.value = roomFromUrl.toUpperCase();
    }

    // --- Screen Navigation ---
    function showScreen(screenName) {
        Object.keys(screens).forEach(k => {
            screens[k].classList.remove('active');
        });
        if (screens[screenName]) {
            screens[screenName].classList.add('active');
        }
    }

    // --- Avatar Selection ---
    avatarGrid.addEventListener('click', (e) => {
        const target = e.target.closest('.avatar-option');
        if (!target) return;
        document.querySelectorAll('.avatar-option').forEach(btn => btn.classList.remove('selected'));
        target.classList.add('selected');
        selectedAvatar = target.getAttribute('data-avatar');
        window.sound.playClick();
    });

    // --- Sound Mute Toggle ---
    btnMute.addEventListener('click', () => {
        const isMuted = window.sound.toggleMute();
        btnMute.textContent = isMuted ? '🔇' : '🔊';
    });
    if (window.sound.muted) btnMute.textContent = '🔇';

    // --- Rules Modal ---
    btnRules.addEventListener('click', () => {
        window.sound.playClick();
        modalRules.classList.add('active');
    });
    btnCloseRules.addEventListener('click', () => {
        window.sound.playClick();
        modalRules.classList.remove('active');
    });
    modalRules.addEventListener('click', (e) => {
        if (e.target === modalRules) modalRules.classList.remove('active');
    });

    // --- Copy Room Invite Link ---
    btnCopyCode.addEventListener('click', async () => {
        if (!currentRoomCode) return;
        const inviteUrl = `${window.location.origin}/?room=${currentRoomCode}`;
        try {
            await navigator.clipboard.writeText(inviteUrl);
            copyIcon.textContent = '✅';
            copyText.textContent = 'Invite Link Copied!';
            window.sound.playClick();
            setTimeout(() => {
                copyIcon.textContent = '📋';
                copyText.textContent = 'Click to copy invite link';
            }, 2500);
        } catch (err) {
            prompt('Copy this invite link:', inviteUrl);
        }
    });

    // --- Room Creation & Joining ---
    btnCreateRoom.addEventListener('click', async () => {
        window.sound.init();
        window.sound.playClick();
        const name = (inputPlayerName.value || 'Player').trim();
        localStorage.setItem('bombrush_player_name', name);

        try {
            const res = await fetch('/api/room/create', { method: 'POST' });
            const data = await res.json();
            currentRoomCode = data.code;
            connectWebSocket(currentRoomCode, name);
        } catch (err) {
            alert('Failed to create room. Please check connection.');
        }
    });

    btnJoinRoom.addEventListener('click', () => {
        window.sound.init();
        window.sound.playClick();
        const code = (inputRoomCode.value || '').trim().toUpperCase();
        if (!code) {
            alert('Please enter a room code');
            return;
        }
        const name = (inputPlayerName.value || 'Player').trim();
        localStorage.setItem('bombrush_player_name', name);
        currentRoomCode = code;
        connectWebSocket(currentRoomCode, name);
    });

    // --- WebSocket Client ---
    function connectWebSocket(roomCode, playerName) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/${roomCode}/${playerId}`;

        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            console.log('Connected to room:', roomCode);
            // Send join message
            socket.send(JSON.stringify({
                type: 'join',
                name: playerName,
                avatar: selectedAvatar
            }));
            // Update URL without page reload
            window.history.replaceState({}, '', `?room=${roomCode}`);
        };

        socket.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                handleServerMessage(msg);
            } catch (err) {
                console.error('Error parsing WS message:', err);
            }
        };

        socket.onclose = () => {
            console.log('Disconnected from room');
        };

        socket.onerror = (err) => {
            console.error('WS Error:', err);
        };
    }

    // --- Server Message Router ---
    function handleServerMessage(msg) {
        switch (msg.type) {
            case 'room_state':
                updateLobbyUI(msg.room);
                break;

            case 'settings_updated':
                currentTurnTimer = msg.time_limit;
                currentLives = msg.lives;
                break;

            case 'game_started':
                startGameArena(msg.room);
                break;

            case 'turn_start':
                handleTurnStart(msg);
                break;

            case 'timer_tick':
                handleTimerTick(msg);
                break;

            case 'word_accepted':
                handleWordAccepted(msg);
                break;

            case 'word_rejected':
                handleWordRejected(msg);
                break;

            case 'bomb_exploded':
                handleBombExploded(msg);
                break;

            case 'player_eliminated':
                handlePlayerEliminated(msg);
                break;

            case 'game_over':
                handleGameOver(msg);
                break;

            case 'reaction_broadcast':
                spawnFloatingEmoji(msg.emoji);
                break;
        }
    }

    // --- UI Update: Lobby ---
    function updateLobbyUI(room) {
        if (room.state === 'PLAYING') {
            startGameArena(room);
            return;
        }

        modalGameOver.classList.remove('active');
        showScreen('lobby');

        currentRoomCode = room.code;
        lobbyRoomCode.textContent = room.code;
        isHost = (room.host_id === playerId);

        // Host settings & button visibility
        if (isHost) {
            hostSettingsBox.style.display = 'block';
            btnStartGame.style.display = 'flex';
            waitingForHostText.style.display = 'none';
        } else {
            hostSettingsBox.style.display = 'none';
            btnStartGame.style.display = 'none';
            waitingForHostText.style.display = 'block';
        }

        // Render player cards
        const connectedPlayers = room.players.filter(p => p.is_connected);
        lobbyPlayerCount.textContent = connectedPlayers.length;
        lobbyPlayersGrid.innerHTML = '';

        connectedPlayers.forEach(p => {
            const card = document.createElement('div');
            card.className = `player-card ${p.id === playerId ? 'is-you' : ''}`;
            card.innerHTML = `
                <div class="player-avatar">${p.avatar}</div>
                <div class="player-info">
                    <div class="player-name">${escapeHtml(p.name)}</div>
                    <div style="display: flex; gap: 4px; margin-top: 4px;">
                        ${p.id === room.host_id ? '<span class="player-badge badge-host">HOST</span>' : ''}
                        ${p.id === playerId ? '<span class="player-badge badge-you">YOU</span>' : ''}
                    </div>
                </div>
            `;
            lobbyPlayersGrid.appendChild(card);
        });
    }

    // --- Host Settings Interaction ---
    document.querySelectorAll('#timerSelector .pill-option').forEach(el => {
        el.addEventListener('click', () => {
            if (!isHost) return;
            document.querySelectorAll('#timerSelector .pill-option').forEach(p => p.classList.remove('active'));
            el.classList.add('active');
            currentTurnTimer = parseFloat(el.getAttribute('data-timer'));
            sendSettingsUpdate();
        });
    });

    document.querySelectorAll('#livesSelector .pill-option').forEach(el => {
        el.addEventListener('click', () => {
            if (!isHost) return;
            document.querySelectorAll('#livesSelector .pill-option').forEach(p => p.classList.remove('active'));
            el.classList.add('active');
            currentLives = parseInt(el.getAttribute('data-lives'));
            sendSettingsUpdate();
        });
    });

    function sendSettingsUpdate() {
        if (!socket || !isHost) return;
        socket.send(JSON.stringify({
            type: 'update_settings',
            time_limit: currentTurnTimer,
            lives: currentLives
        }));
    }

    // --- Start Game Button ---
    btnStartGame.addEventListener('click', () => {
        if (!socket || !isHost) return;
        window.sound.playClick();
        socket.send(JSON.stringify({
            type: 'start_game',
            time_limit: currentTurnTimer,
            lives: currentLives
        }));
    });

    // --- Start Game Arena ---
    function startGameArena(room) {
        showScreen('game');
        modalGameOver.classList.remove('active');
        wordsHistory.innerHTML = '';
        inputFeedback.textContent = '';
        renderPlayersStrip(room.players, room.active_player_id);

        if (room.current_prompt) {
            promptDisplay.textContent = room.current_prompt;
        }

        window.sound.playSuccess();
        startSparkAnimation();
    }

    // --- Render Players Strip in Game ---
    function renderPlayersStrip(players, activePlayerId) {
        gamePlayersStrip.innerHTML = '';
        players.forEach(p => {
            const pill = document.createElement('div');
            const isTurn = (p.id === activePlayerId);
            const isDead = (!p.is_alive || p.lives <= 0);

            pill.className = `arena-player-pill ${isTurn ? 'turn-active' : ''} ${isDead ? 'eliminated' : ''}`;

            // Generate hearts
            let heartsHtml = '';
            for (let i = 0; i < 3; i++) {
                if (i < p.lives) {
                    heartsHtml += '<span>❤️</span>';
                } else {
                    heartsHtml += '<span style="opacity: 0.35;">🖤</span>';
                }
            }

            pill.innerHTML = `
                <span style="font-size: 1.3rem;">${p.avatar}</span>
                <div>
                    <div style="font-size: 0.85rem; font-weight: 700;">${escapeHtml(p.name)}</div>
                    <div class="player-lives">${heartsHtml}</div>
                </div>
            `;
            gamePlayersStrip.appendChild(pill);
        });
    }

    // --- Turn Start Event ---
    function handleTurnStart(msg) {
        currentPrompt = msg.prompt;
        promptDisplay.textContent = msg.prompt;
        currentLimit = msg.time_limit || 8.0;
        remainingTime = msg.time_remaining || currentLimit;
        lastTickTime = Date.now();

        isMyTurn = (msg.active_player_id === playerId);

        // Turn message & input state
        if (isMyTurn) {
            turnBanner.className = 'turn-banner your-turn';
            turnBannerEmoji.textContent = '🔥';
            turnBannerText.textContent = 'YOUR TURN! TYPE FAST!';
            wordInput.disabled = false;
            btnSubmitWord.disabled = false;
            wordInput.value = '';
            wordInput.focus();
            window.sound.playTick(1.2);
        } else {
            const activePlayer = (msg.players || []).find(p => p.id === msg.active_player_id);
            const activeName = activePlayer ? activePlayer.name : 'Opponent';
            turnBanner.className = 'turn-banner';
            turnBannerEmoji.textContent = '💣';
            turnBannerText.textContent = `Waiting for @${activeName}...`;
            wordInput.disabled = true;
            btnSubmitWord.disabled = true;
            wordInput.value = '';
        }

        inputFeedback.textContent = '';
        renderPlayersStrip(msg.players, msg.active_player_id);
        startTimerCountdown();
    }

    // --- Client Smooth Timer Countdown ---
    function startTimerCountdown() {
        if (timerAnimFrame) cancelAnimationFrame(timerAnimFrame);

        function updateTimer() {
            const now = Date.now();
            const delta = (now - lastTickTime) / 1000;
            lastTickTime = now;

            remainingTime = Math.max(0, remainingTime - delta);

            // Update SVG progress ring
            const circumference = 785.4; // 2 * pi * 125
            const progress = remainingTime / currentLimit;
            const offset = circumference * (1 - progress);
            timerCircleProgress.style.strokeDashoffset = offset;

            // Change color and urgency as time runs out
            if (remainingTime < 2.5) {
                timerCircleProgress.style.stroke = 'var(--accent-red)';
                bombGraphic.classList.add('ticking-urgency');
            } else if (remainingTime < 4.5) {
                timerCircleProgress.style.stroke = 'var(--accent-gold)';
                bombGraphic.classList.remove('ticking-urgency');
            } else {
                timerCircleProgress.style.stroke = 'var(--accent-cyan)';
                bombGraphic.classList.remove('ticking-urgency');
            }

            timerSecondsText.textContent = `${remainingTime.toFixed(1)}s`;

            if (remainingTime > 0) {
                timerAnimFrame = requestAnimationFrame(updateTimer);
            }
        }

        lastTickTime = Date.now();
        timerAnimFrame = requestAnimationFrame(updateTimer);
    }

    function handleTimerTick(msg) {
        remainingTime = msg.time_remaining;
        currentLimit = msg.time_limit;
        lastTickTime = Date.now();

        // Audio ticking sound
        if (remainingTime <= 3.0) {
            window.sound.playTick(1.8);
        } else if (remainingTime <= 5.0) {
            window.sound.playTick(1.0);
        }
    }

    // --- Word Submission ---
    function submitWord() {
        if (!isMyTurn || !socket) return;
        const word = (wordInput.value || '').trim().toUpperCase();
        if (!word) return;

        socket.send(JSON.stringify({
            type: 'submit_word',
            word: word
        }));
    }

    document.getElementById('wordForm').addEventListener('submit', (e) => {
        e.preventDefault();
        submitWord();
    });

    btnSubmitWord.addEventListener('click', submitWord);

    // Auto-uppercase as user types
    wordInput.addEventListener('input', () => {
        wordInput.value = wordInput.value.toUpperCase();
    });

    // --- Word Accepted ---
    function handleWordAccepted(msg) {
        window.sound.playSuccess();
        bombGraphic.classList.remove('ticking-urgency');

        // Append to history
        const pill = document.createElement('div');
        pill.className = 'word-pill';
        pill.innerHTML = `<span>${msg.player_name}:</span> <strong>${msg.word}</strong> <span style="color: var(--accent-gold); font-size: 0.75rem;">+${msg.points}</span>`;
        wordsHistory.prepend(pill);

        if (msg.player_id === playerId) {
            inputFeedback.className = 'input-feedback feedback-success';
            inputFeedback.textContent = `✅ "${msg.word}" +${msg.points} pts!`;
            wordInput.value = '';
        }
    }

    // --- Word Rejected ---
    function handleWordRejected(msg) {
        window.sound.playError();
        wordInput.classList.remove('shake-error');
        void wordInput.offsetWidth; // Trigger reflow
        wordInput.classList.add('shake-error');

        inputFeedback.className = 'input-feedback feedback-error';
        inputFeedback.textContent = `❌ ${msg.reason}`;
    }

    // --- Bomb Exploded ---
    function handleBombExploded(msg) {
        window.sound.playBoom();
        bombGraphic.classList.remove('ticking-urgency');

        // Screen shake
        document.body.classList.add('screen-shake');
        setTimeout(() => document.body.classList.remove('screen-shake'), 600);

        turnBanner.className = 'turn-banner';
        turnBannerEmoji.textContent = '💥';
        turnBannerText.textContent = `BOOM! Bomb exploded on @${msg.player_name}!`;
    }

    // --- Player Eliminated ---
    function handlePlayerEliminated(msg) {
        turnBannerEmoji.textContent = '💀';
        turnBannerText.textContent = `@${msg.player_name} was eliminated!`;
    }

    // --- Game Over ---
    function handleGameOver(msg) {
        if (timerAnimFrame) cancelAnimationFrame(timerAnimFrame);
        bombGraphic.classList.remove('ticking-urgency');

        const winner = msg.winner;
        winnerAvatar.textContent = winner.avatar || '😎';
        winnerName.textContent = `${winner.name} Wins! 🏆`;
        winnerScore.textContent = `Final Score: ${winner.score || 0} pts`;

        statLongestWord.textContent = msg.stats?.longest_word || 'NONE';
        statTotalWords.textContent = msg.stats?.total_words || '0';

        modalGameOver.classList.add('active');
        window.sound.playVictory();
        startConfetti();
    }

    btnPlayAgain.addEventListener('click', () => {
        window.sound.playClick();
        if (socket) {
            socket.send(JSON.stringify({ type: 'play_again' }));
        }
    });

    // --- In-Game Emoji Reactions ---
    document.querySelectorAll('.reaction-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const emoji = btn.getAttribute('data-emoji');
            if (socket) {
                socket.send(JSON.stringify({
                    type: 'reaction',
                    emoji: emoji
                }));
            }
        });
    });

    function spawnFloatingEmoji(emoji) {
        const span = document.createElement('span');
        span.className = 'floating-emoji';
        span.textContent = emoji;

        // Random horizontal position near center
        const x = window.innerWidth / 2 + (Math.random() * 200 - 100);
        const y = window.innerHeight * 0.75;
        span.style.left = `${x}px`;
        span.style.top = `${y}px`;

        document.body.appendChild(span);
        setTimeout(() => span.remove(), 1800);
    }

    // --- Animated Fuse Sparks Canvas ---
    function startSparkAnimation() {
        const canvas = document.getElementById('sparkCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const particles = [];

        function renderSparks() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Add new sparks
            for (let i = 0; i < 2; i++) {
                particles.push({
                    x: canvas.width / 2,
                    y: canvas.height / 2,
                    vx: (Math.random() - 0.5) * 4,
                    vy: (Math.random() - 0.5) * 4 - 1.5,
                    size: Math.random() * 3 + 1,
                    alpha: 1,
                    color: Math.random() > 0.4 ? '#ff9f1a' : '#ffd32a'
                });
            }

            // Update & draw sparks
            for (let i = particles.length - 1; i >= 0; i--) {
                const p = particles[i];
                p.x += p.vx;
                p.y += p.vy;
                p.alpha -= 0.04;
                p.size = Math.max(0.5, p.size * 0.95);

                if (p.alpha <= 0) {
                    particles.splice(i, 1);
                    continue;
                }

                ctx.save();
                ctx.globalAlpha = p.alpha;
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }

            requestAnimationFrame(renderSparks);
        }

        renderSparks();
    }

    // --- Victory Confetti Physics Engine ---
    function startConfetti() {
        const canvas = document.getElementById('confettiCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const pieces = [];
        const colors = ['#ff4757', '#ffa502', '#2ed573', '#00d2d3', '#ffd32a', '#a55eea'];

        for (let i = 0; i < 150; i++) {
            pieces.push({
                x: Math.random() * canvas.width,
                y: Math.random() * -canvas.height,
                size: Math.random() * 8 + 6,
                color: colors[Math.floor(Math.random() * colors.length)],
                vx: (Math.random() - 0.5) * 4,
                vy: Math.random() * 4 + 3,
                rotation: Math.random() * 360,
                rSpeed: (Math.random() - 0.5) * 8
            });
        }

        let animId;
        let frames = 0;

        function drawConfetti() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            frames++;

            pieces.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;
                p.rotation += p.rSpeed;

                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate((p.rotation * Math.PI) / 180);
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
                ctx.restore();
            });

            if (frames < 300) {
                animId = requestAnimationFrame(drawConfetti);
            } else {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        }

        drawConfetti();
    }

    // Helper: Escape HTML string
    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>"']/g, m => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[m]));
    }

})();
