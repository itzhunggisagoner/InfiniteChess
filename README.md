# Infinite Chess

Chess on an endless board. Play against a strong engine, share a screen with a friend, jump into an online room, or try four-player chess with friends and bots.

## Ways to play

- **Play the engine**: pick your color, difficulty, variant and time limit. Powered by Stockfish 19 plus a built-in engine for the wilder variants.
- **Play 2 Players**: two people, one device.
- **Play online**: create a public or private room and share the 4-digit code, or open the **Room list** to join any public room with a free seat.
- **4 Player Chess**: available offline (with bots) and online.

## Variants

Standard, King of the Hill, Three-check, Triple Queens, Chess960, Atomic, Antichess, Racing Kings and 4 Player Chess.

## Four-player chess

- **Endless board**: drag to pan, pinch or scroll to zoom, and tap Center to jump back to the starting cross.
- **Your color is always at the bottom**: the board rotates to match your seat.
- **Bots anywhere**: fill any empty seat with a bot, offline or online. If a player leaves mid-game, a bot takes over.
- **Online rooms**:
  - The host picks the time limit and Public or Private, and everyone in the lobby sees changes instantly.
  - The host can add or remove bots, kick players, and press **Start** once all four seats are filled.
  - **Play again** takes everyone back to the lobby after a game.
- **Room chat**: talk in the lobby and during the game. Names are colored like the pieces, and the menu button shows a red badge with the number of unread messages.
- **Clear scoreboard**: player names and clocks sit in the top-left corner in their piece colors, with captured-piece points next to each name.
- **Polished feel**: piece selection animations, drag and drop, sliding moves, capture effects, a red flash and sound on illegal moves, and a warning when your king is under attack.

## Accounts, usernames and chat

- **Sign in with Google** to create a username. Usernames are unique (not case-sensitive), 3-14 characters, and permanent for that Google account.
- **Guests** can still just type a name. It is checked too: it can't match a registered username or a name someone is using right now, and it can't be a reserved word (Bot, Admin, colors...). Leave it empty to get a random `Guest1234`.
- **Chat is locked** unless you are signed in with Google and have a username. Locked players can't send or receive messages (checked on the server, not just hidden in the UI). Chat names are always the verified username.
- One Google account can only be online once at a time.

### Setting up Google sign-in

1. Open Google Cloud Console, go to **APIs & Services > Credentials** and create an **OAuth client ID** of type **Web application**.
2. Under **Authorized redirect URIs** add every address the site is served from, with a trailing slash, for example `https://your-site.workers.dev/` and `http://localhost:3000/`.
3. Copy the client ID.
   - **Cloudflare**: put it in `wrangler.toml` as `GOOGLE_CLIENT_ID`, then deploy. Usernames are stored in the Durable Object's storage.
   - **Node**: run `GOOGLE_CLIENT_ID=your-id node server.js`. Usernames are saved in `accounts.json` next to `server.js` (change it with `ACCOUNTS_FILE`).

Without a client ID the game works as before, the Google button is hidden and chat stays locked.

## Everywhere

- Endless board with smooth pan and zoom on desktop and mobile
- Online rooms with in-room chat
- Chess clocks with custom time controls
- Board color themes, sound and motion settings
- Translucent glass interface

## Credits
White and Black chess piece by [Chess.com](chess.com)
Four-player chess piece art by [KylerCondran](https://github.com/KylerCondran/4PlayerChess). Released under the MIT License.
