# CSP-GAMES

Phone-as-controller multiplayer games with a desktop game screen. Supports **local LAN development** and **cloud deployment on Render**.

## Games

| Game | Desktop | Phone controller |
|------|---------|------------------|
| **Tennis** | `/games/tennis` | `/controller?game=tennis&room=CODE` |
| **Ping Pong** | `/games/pingpong` | `/controller?game=pingpong&room=CODE` |

Open the hub at `/` to pick a game.

## Local development (LAN)

Requires Node.js 18+.

```bash
npm install
npm run dev
```

Or on Windows: `start.bat` (starts server + Cloudflare tunnel for iPhone HTTPS motion sensors).

- Hub: `http://<your-lan-ip>:3000/`
- Tennis: `http://<your-lan-ip>:3000/games/tennis`
- HTTPS (iOS sensors): `https://<your-lan-ip>:3443` or tunnel URL from `start.bat`

## Production (Render)

1. Push to `main` on GitHub
2. Connect repo in Render → New Web Service
3. Set `PUBLIC_URL=https://<your-service>.onrender.com`
4. Health check: `GET /health`

Render uses a single HTTPS port — no tunnel needed on phones.

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Production server (single port, `NODE_ENV=production`) |
| `npm run dev` | LAN dev + optional Cloudflare tunnel |
| `npm test` | Unit + integration tests |

## Tests

```bash
npm test
```

CI runs on every push/PR via GitHub Actions.

## Architecture

```
server.js              Entry point
src/config/public-url  PUBLIC_URL / Render URL resolution
src/server/app.js      Express routes + static files
src/server/room-store  In-memory rooms (game-scoped keys)
src/server/game-registry  Tennis, ping pong metadata
src/server/socket-router  Socket.io join / relay
public/index.html      Game hub
public/games/*         Per-game screen + controller assets
```

## License

Private / project use.
