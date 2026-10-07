# Offline Dice Discord Bot

## What it does
- `/settarget @DiscordUser` selects the Discord user whose voice channel is followed.
- `/setdiceuser <OfflineDiceUsername>` selects the Offline Dice account.
- `/start` starts the capture agent.
- `/stop` stops it.
- `/region` opens a desktop selection overlay. Select ONLY the marked trade-chat area.
- `/status` shows the current configuration.
- When a color is detected in the selected desktop region, that color is temporarily added to the user's disabled-color list for 15 seconds, then restored.
- The bot logs OFF/ON events to the configured Discord log channel.

## Important Discord limitation
A normal Discord bot cannot receive another user's Discord screen-share video frames through the standard Discord bot API. Therefore this project uses:
1. Discord bot: follows the selected user's voice channel and handles commands/logs.
2. Local capture agent: captures only the selected rectangle on the computer where the agent runs.

This means the Discord desktop/client must be visible on the machine running the capture agent.

## Setup
1. Install Node.js 20+.
2. Install Python 3.11+.
3. Install Tesseract OCR and make sure `tesseract` is in PATH.
4. `npm install`
5. `pip install -r requirements.txt`
6. Copy `.env.example` to `.env` and fill it.
7. Enable the bot's `Guilds`, `GuildVoiceStates`, and `GuildMessages` intents as needed in the Discord Developer Portal.
8. Invite the bot with permissions including `View Channel`, `Connect`, `Move Members` (the latter is needed for moving the bot to the target user's channel), and `Send Messages`.
9. Start with `npm start`.

The bot does not modify the Worker code. It uses the existing `/u` and `/p` endpoints.
