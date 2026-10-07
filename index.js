require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType
} = require("discord.js");
const { spawn } = require("child_process");

const TOKEN = process.env.DISCORD_TOKEN;
const WORKER = (process.env.WORKER_BASE_URL || "").replace(/\/+$/, "");
const USER_TOKEN = process.env.USER_SETTINGS_TOKEN;
const GUILD_ID = process.env.GUILD_ID || "";
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || "";

if (!TOKEN || !WORKER || !USER_TOKEN) {
  console.error("Missing DISCORD_TOKEN, WORKER_BASE_URL or USER_SETTINGS_TOKEN in .env");
  process.exit(1);
}

const COLORS = ["red", "orange", "gold", "green", "blue", "purple"];
const state = {
  targetDiscordUserId: null,
  diceUsername: null,
  diceUid: null,
  captureProcess: null,
  regionProcess: null,
  lastDetected: new Map(),
  originalDisabled: new Set(),
  temporaryDisabled: new Map()
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages
  ]
});

async function worker(path, options = {}) {
  const headers = {
    "Authorization": `Bearer ${USER_TOKEN}`,
    "Content-Type": "application/json"
  };
  const res = await fetch(`${WORKER}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function getUsers() {
  const data = await worker("/u");
  return Array.isArray(data.users) ? data.users : [];
}

async function getPrefs(uid) {
  return worker(`/p?u=${encodeURIComponent(uid)}`);
}

async function savePrefs(uid, prefs) {
  return worker("/p", {
    method: "POST",
    body: JSON.stringify({
      u: uid,
      x: prefs.x || [],
      g: prefs.g || [],
      diceColors: prefs.diceColors || []
    })
  });
}

function colorIndex(color) {
  return COLORS.indexOf(color);
}

async function setTemporaryOff(color) {
  if (!state.diceUid) return;
  const idx = colorIndex(color);
  if (idx < 0) return;

  const prefs = await getPrefs(state.diceUid);
  const disabled = new Set(Array.isArray(prefs.x) ? prefs.x : []);

  // Already disabled by the user: don't schedule an ON that would undo it.
  if (disabled.has(idx)) return;

  disabled.add(idx);
  state.temporaryDisabled.set(color, {
    index: idx,
    restoreAt: Date.now() + 15000
  });

  await savePrefs(state.diceUid, {
    ...prefs,
    x: [...disabled].sort((a,b) => a-b)
  });

  await log(`🔴 **${color.toUpperCase()} OFF** — ${state.diceUsername} — 15 Sekunden`);

  setTimeout(async () => {
    try {
      const current = await getPrefs(state.diceUid);
      const currentDisabled = new Set(Array.isArray(current.x) ? current.x : []);
      currentDisabled.delete(idx);

      await savePrefs(state.diceUid, {
        ...current,
        x: [...currentDisabled].sort((a,b) => a-b)
      });

      state.temporaryDisabled.delete(color);
      await log(`🟢 **${color.toUpperCase()} ON** — ${state.diceUsername}`);
    } catch (e) {
      await log(`⚠️ **${color.toUpperCase()} konnte nicht wieder aktiviert werden:** ${e.message}`);
    }
  }, 15000);
}

async function log(message) {
  if (!LOG_CHANNEL_ID) return;
  try {
    const ch = await client.channels.fetch(LOG_CHANNEL_ID);
    if (ch && ch.isTextBased()) await ch.send(message);
  } catch (e) {
    console.error("Discord log error:", e.message);
  }
}

function pythonCommand() {
  return process.env.PYTHON_COMMAND || "python";
}

function startCapture() {
  if (state.captureProcess) return false;
  const p = spawn(pythonCommand(), ["capture_agent.py", "--watch"], {
    cwd: __dirname,
    stdio: ["ignore", "pipe", "pipe"]
  });
  state.captureProcess = p;
  p.stdout.on("data", async buf => {
    for (const line of buf.toString().split(/\r?\n/)) {
      const s = line.trim();
      if (!s) continue;
      try {
        const msg = JSON.parse(s);
        if (msg.type === "color" && COLORS.includes(msg.color)) {
          const now = Date.now();
          const last = state.lastDetected.get(msg.color) || 0;
          if (now - last > 2000) {
            state.lastDetected.set(msg.color, now);
            await setTemporaryOff(msg.color);
          }
        }
      } catch {
        console.log("[capture]", s);
      }
    }
  });
  p.stderr.on("data", buf => console.error("[capture]", buf.toString().trim()));
  p.on("exit", () => { state.captureProcess = null; });
  return true;
}

function stopCapture() {
  if (!state.captureProcess) return false;
  state.captureProcess.kill();
  state.captureProcess = null;
  return true;
}

async function followTarget(guild) {
  if (!state.targetDiscordUserId) return;
  const member = await guild.members.fetch(state.targetDiscordUserId).catch(() => null);
  if (!member?.voice?.channel) return;
  const me = guild.members.me;
  if (!me) return;
  if (!me.voice.channel || me.voice.channel.id !== member.voice.channel.id) {
    try {
      await me.voice.setChannel(member.voice.channel);
      await log(`🎧 Bot ist **${member.user.tag}** in **${member.voice.channel.name}** gefolgt.`);
    } catch (e) {
      await log(`⚠️ Konnte dem Call nicht beitreten: ${e.message}`);
    }
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName("settarget")
    .setDescription("Discord-Benutzer auswählen, dessen Voice-Channel verfolgt wird")
    .addUserOption(o => o.setName("user").setDescription("Discord-Benutzer").setRequired(true)),
  new SlashCommandBuilder()
    .setName("setdiceuser")
    .setDescription("Offline-Dice-Benutzer auswählen")
    .addStringOption(o => o.setName("username").setDescription("Offline-Dice Username").setRequired(true)),
  new SlashCommandBuilder().setName("start").setDescription("Farberkennung starten"),
  new SlashCommandBuilder().setName("stop").setDescription("Farberkennung stoppen"),
  new SlashCommandBuilder().setName("region").setDescription("Bereich auf dem Desktop auswählen"),
  new SlashCommandBuilder().setName("status").setDescription("Bot-Konfiguration anzeigen")
].map(c => c.toJSON());

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
  } else {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  }
});

client.on("voiceStateUpdate", async (oldState, newState) => {
  if (newState.member?.id !== state.targetDiscordUserId) return;
  await followTarget(newState.guild);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "settarget") {
      const user = interaction.options.getUser("user", true);
      state.targetDiscordUserId = user.id;
      await interaction.reply(`🎯 Ziel gesetzt: **${user.tag}**`);
      await followTarget(interaction.guild);
      return;
    }

    if (interaction.commandName === "setdiceuser") {
      const username = interaction.options.getString("username", true).trim();
      const users = await getUsers();
      const found = users.find(u => String(u.username || u.name || "").toLowerCase() === username.toLowerCase());
      if (!found) {
        await interaction.reply({ content: `❌ Offline-Dice-User **${username}** nicht gefunden.`, ephemeral: true });
        return;
      }
      state.diceUsername = String(found.username || found.name || username);
      state.diceUid = String(found.id);
      await interaction.reply(`🎲 Offline-Dice-User gesetzt: **${state.diceUsername}**`);
      return;
    }

    if (interaction.commandName === "start") {
      if (!state.diceUid) {
        await interaction.reply({ content: "❌ Erst `/setdiceuser` setzen.", ephemeral: true });
        return;
      }
      const started = startCapture();
      await interaction.reply(started ? "▶️ Farberkennung gestartet." : "ℹ️ Farberkennung läuft bereits.");
      return;
    }

    if (interaction.commandName === "stop") {
      const stopped = stopCapture();
      await interaction.reply(stopped ? "⏹️ Farberkennung gestoppt." : "ℹ️ Farberkennung läuft nicht.");
      return;
    }

    if (interaction.commandName === "region") {
      if (state.regionProcess) {
        await interaction.reply({ content: "ℹ️ Die Bereichsauswahl läuft bereits.", ephemeral: true });
        return;
      }
      state.regionProcess = spawn(pythonCommand(), ["capture_agent.py", "--select"], {
        cwd: __dirname,
        stdio: "inherit"
      });
      state.regionProcess.on("exit", async () => {
        state.regionProcess = null;
        await log("📐 Capture-Bereich wurde neu ausgewählt.");
      });
      await interaction.reply("📐 Auswahlfenster wurde auf dem Capture-PC geöffnet. Markiere **nur** den roten Bereich.");
      return;
    }

    if (interaction.commandName === "status") {
      const target = state.targetDiscordUserId ? `<@${state.targetDiscordUserId}>` : "nicht gesetzt";
      await interaction.reply(
        `**Offline Dice Bot**\n` +
        `Discord-Ziel: ${target}\n` +
        `Offline-Dice-User: ${state.diceUsername || "nicht gesetzt"}\n` +
        `Capture: ${state.captureProcess ? "🟢 aktiv" : "🔴 aus"}`
      );
    }
  } catch (e) {
    console.error(e);
    if (!interaction.replied) {
      await interaction.reply({ content: `❌ ${e.message}`, ephemeral: true });
    }
  }
});

client.login(TOKEN);
