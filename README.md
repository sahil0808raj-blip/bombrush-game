# 💣 BombRush — Real-Time Multiplayer Word Battle

> **Handshake AI Skills Studio Challenge Submission**  
> Complete cross-device multiplayer party game built with real-time WebSockets, instant room codes, 83,000+ official Scrabble word validation, audio synthesis, and arcade animations.

---

## 🎮 Game Concept & Rules

**BombRush** is a high-octane multiplayer party game that anyone can pick up in 5 seconds without prior explanation:

1. **Join Instantly:** Enter your nickname, pick an avatar, and enter a 4-letter Room Code (or click a share link). No login or app download required!
2. **Watch the Bomb:** When it’s your turn, the bomb points to you with letters inside (e.g. `PRO`, `STA`, `ING`).
3. **Type Fast:** Type any valid English word containing those letters (e.g., `PROGRAM` for `PRO`) and hit Enter.
4. **Pass Before It Blows:** A valid word immediately passes the ticking bomb to the next player! If your 8-second timer hits zero, the bomb explodes and you lose a life (❤️❤️❤️). Last player standing wins the championship crown 🏆!

---

## 🚀 How to Play Right Now

The server is currently running on your machine on port `8000`.

### 1. On your PC / Laptop:
Open your browser and visit:
👉 **`http://localhost:8000`**

### 2. On your Mobile Phone (Same Wi-Fi):
Connect your phone to the same Wi-Fi and visit:
👉 **`http://192.168.31.178:8000`**

- Create a room on your laptop, then type the 4-letter code on your phone (or click the copy invite link).
- Hit **"Start Battle"** to experience real-time cross-device gameplay!

---

## 🌐 Deploying to a Free Public Link (For Handshake Submission)

To get a live public link (`https://bombrush-game.onrender.com`) that anyone in the world can open:

### Option A: Render.com (Recommended, 100% Free)
1. Push this folder to a GitHub repository:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/bombrush-game.git
   git branch -M main
   git push -u origin main
   ```
2. Go to [Render.com](https://render.com) and click **New + > Web Service**.
3. Select your GitHub repository.
4. Set:
   - **Environment:** `Python`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Click **Create Web Service**. Within 2 minutes, Render will give you a public URL (e.g. `https://bombrush-xyz.onrender.com`)!

---

## 📝 Handshake Submission Template

When submitting your project on Handshake, you can use this template:

- **Project Title:** BombRush — Real-Time Multiplayer Word Battle
- **Public URL:** `[Paste your Render URL here]`
- **Project Summary:**  
  *BombRush is a fast-paced multiplayer party game that connects friends across phones and laptops using real-time WebSockets and 4-letter room codes. Players race against a ticking bomb timer to type words matching random syllable prompts validated against an 83,000+ Scrabble dictionary. The game features synthesized Web Audio sound effects, SVG progress rings, spark physics, floating live emoji reactions, and smooth responsive gameplay without any login or downloads.*
- **What I Learned:**  
  *How to architect real-time bidirectional WebSocket synchronization, handle game state management and turns across multiple devices, implement fault-tolerant dictionary verification, and iterate through the prompt-and-debug loop to deliver a polished, accessible web game.*
