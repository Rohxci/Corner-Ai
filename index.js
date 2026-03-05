require("dotenv").config();

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

/* =========================
   CONFIG
========================= */

const STAFF_CHANNEL = "1478869019783335957";

const NEW_ACCOUNT_HOURS = 48;

const RAID_JOIN_THRESHOLD = 5;
const RAID_WINDOW_MS = 60_000;

const SAFE_DOMAINS = [
  "discord.com",
  "discord.gg",
  "youtube.com",
  "youtu.be",
  "tenor.com",
  "giphy.com",
  "imgur.com"
];

/* =========================
   MEMORY (in-RAM)
========================= */

let serverTimeline = [];
let conversationMemory = {}; // channelId -> [{userId, content, url, msgId, channelId}]
let joinTracker = [];

let userRisk = {};  // userId -> number
let userTrust = {}; // userId -> number

let violationCount = 0;

/* =========================
   CLIENT
========================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

/* =========================
   VIOLATION PATTERNS (fast & free)
========================= */

const VIOLATIONS = {
  spam: [
    /(.)\1{8,}/i,
    /\bspam\b/i,
    /\bbuy\s*now\b/i,
    /\blimited\s*offer\b/i,
    /\bcheap\s*price\b/i,
    /\bearn\s*money\b/i,
    /\bfast\s*cash\b/i,
    /\bclick\s*here\b/i
  ],

  caps: [
    /^[^a-z]*[A-Z]{12,}[^a-z]*$/
  ],

  scam: [
    /\bfree\s*nitro\b/i,
    /\bnitro\s*giveaway\b/i,
    /\bclaim\s*nitro\b/i,
    /\bsteam\s*gift\b/i,
    /\bgift\s*card\b/i,
    /\bcrypto\s*reward\b/i,
    /\bairdrop\b/i,
    /\bclaim\s*reward\b/i
  ],

  phishing: [
    /\bverify\s*account\b/i,
    /\bconfirm\s*password\b/i,
    /\bsecurity\s*check\b/i,
    /\baccount\s*locked\b/i,
    /\blogin\s*required\b/i,
    /\bverify\s*now\b/i
  ],

  advertising: [
    /\bsubscribe\s*now\b/i,
    /\bcheck\s*my\s*channel\b/i,
    /\bpromo\s*code\b/i,
    /\bvisit\s*my\s*website\b/i,
    /\bjoin\s*my\s*server\b/i,
    /\bdiscord\.gg\/\w+\b/i
  ],

  nsfw: [
    /\bporn\b/i,
    /\bnsfw\b/i,
    /\bxxx\b/i,
    /\bnude\b/i,
    /\bsex\b/i,
    /\bonlyfans\b/i
  ],

  harassment: [
    /\bidiot\b/i,
    /\bmoron\b/i,
    /\bstupid\b/i,
    /\bshut\s*up\b/i,
    /\bloser\b/i,
    /\bkys\b/i
  ],

  // ✅ NO \p{Emoji} (this one works on Node + Railway)
  // counts common emoji ranges (approx), triggers if 10+ emoji-like chars
  emoji_spam: [
    /([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]){10,}/u
  ],

  mass_ping: [
    /@everyone/i,
    /@here/i
  ],

  fake_giveaway: [
    /\bfree\s*giveaway\b/i,
    /\binstant\s*reward\b/i,
    /\blucky\s*winner\b/i
  ]
};

/* =========================
   COMMANDS
========================= */

const commands = [
  new SlashCommandBuilder()
    .setName("ai")
    .setDescription("Ask Cornèr AI (staff only)")
    .addStringOption(o =>
      o.setName("question")
        .setDescription("What do you need?")
        .setRequired(true)
    ),

  new SlashCommandBuilder().setName("aicheck").setDescription("Check AI monitoring status"),
  new SlashCommandBuilder().setName("what").setDescription("Show Cornèr AI capabilities"),
  new SlashCommandBuilder().setName("watch").setDescription("Server overview report"),
  new SlashCommandBuilder().setName("timeline").setDescription("Show recent server activity timeline"),

  new SlashCommandBuilder()
    .setName("user")
    .setDescription("Analyze a server member")
    .addUserOption(o =>
      o.setName("member")
        .setDescription("Select a user")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("risk")
    .setDescription("Check a user's risk score")
    .addUserOption(o =>
      o.setName("member")
        .setDescription("Select a user")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("trust")
    .setDescription("Check a user's trust score")
    .addUserOption(o =>
      o.setName("member")
        .setDescription("Select a user")
        .setRequired(true)
    ),

  new SlashCommandBuilder().setName("stats").setDescription("Moderation statistics"),
  new SlashCommandBuilder().setName("scan").setDescription("Manual scan of this channel (last 50 msgs)"),

  new SlashCommandBuilder().setName("lock").setDescription("Lock server (disable SendMessages for @everyone)"),
  new SlashCommandBuilder().setName("unlock").setDescription("Unlock server (enable SendMessages for @everyone)"),

  new SlashCommandBuilder().setName("slowmode").setDescription("Enable slowmode (10s) in this channel")
];

/* =========================
   READY + REGISTER COMMANDS
========================= */

client.once("ready", async () => {
  console.log("Cornèr AI v5 online");

  try {
    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands.map(c => c.toJSON()) }
    );

    console.log("Slash commands registered.");
  } catch (err) {
    console.error("Command registration failed:", err);
  }
});

/* =========================
   SAFETY: LOG CRASH REASONS
========================= */

process.on("unhandledRejection", (reason) => {
  console.error("UnhandledRejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("UncaughtException:", err);
});

client.on("error", (err) => {
  console.error("Discord client error:", err);
});

/* =========================
   HELPERS
========================= */

function addTimeline(event) {
  serverTimeline.unshift(`${new Date().toLocaleString()} — ${event}`);
  if (serverTimeline.length > 80) serverTimeline.pop();
}

function extractLinks(text) {
  const regex = /(https?:\/\/[^\s]+)/gi;
  return text.match(regex) || [];
}

function suspiciousLink(url) {
  try {
    const { hostname } = new URL(url);
    return !SAFE_DOMAINS.some(d => hostname.includes(d));
  } catch {
    return true;
  }
}

function detectViolation(text) {
  for (const type in VIOLATIONS) {
    for (const pattern of VIOLATIONS[type]) {
      if (pattern.test(text)) return type;
    }
  }
  return null;
}

function bumpScores(userId, severity = 1) {
  userRisk[userId] = (userRisk[userId] || 0) + severity;
  userTrust[userId] = (userTrust[userId] ?? 100) - (5 * severity);
  if (userTrust[userId] < 0) userTrust[userId] = 0;
}

function buildActionRow({ messageId, channelId, userId, jumpUrl }) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`delete_${messageId}_${channelId}`)
      .setLabel("Delete")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId(`timeout_${userId}`)
      .setLabel("Timeout 10m")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setLabel("Jump")
      .setStyle(ButtonStyle.Link)
      .setURL(jumpUrl)
  );
}

async function sendStaffAlert({ title, color, fields, actionRow }) {
  try {
    const staffChannel = await client.channels.fetch(STAFF_CHANNEL);
    if (!staffChannel) return;

    const embed = new EmbedBuilder()
      .setColor(color || "#ff6ec7")
      .setTitle(title)
      .addFields(fields)
      .setTimestamp();

    await staffChannel.send({
      embeds: [embed],
      components: actionRow ? [actionRow] : []
    });
  } catch (err) {
    console.error("Failed to send staff alert:", err);
  }
}

/* =========================
   OPTIONAL AI CHECK (still free if using GROQ)
   Only used AFTER regex triggers.
========================= */

async function analyzeMessageAI(content) {
  if (!process.env.GROQ_KEY) return "UNKNOWN";

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content:
              "Classify the message with ONE WORD: SAFE, SPAM, SCAM, PHISHING, NSFW, HARASSMENT. " +
              "If uncertain, reply SAFE."
          },
          { role: "user", content }
        ],
        temperature: 0
      })
    });

    const data = await res.json();
    const out = (data?.choices?.[0]?.message?.content || "").trim().toUpperCase();

    if (!out) return "SAFE";
    if (["SAFE", "SPAM", "SCAM", "PHISHING", "NSFW", "HARASSMENT"].includes(out)) return out;

    // fallback: if model returns extra text
    if (out.includes("SPAM")) return "SPAM";
    if (out.includes("SCAM")) return "SCAM";
    if (out.includes("PHISH")) return "PHISHING";
    if (out.includes("NSFW")) return "NSFW";
    if (out.includes("HARASS")) return "HARASSMENT";

    return "SAFE";
  } catch (err) {
    console.error("AI analyze failed:", err);
    return "SAFE";
  }
}

/* =========================
   MESSAGE MONITOR (reads all, talks only in STAFF_CHANNEL)
========================= */

client.on("messageCreate", async (message) => {
  if (!message.guild) return;
  if (message.author.bot) return;
  if (message.channel.id === STAFF_CHANNEL) return;

  const content = message.content || "";
  const lower = content.toLowerCase();

  // quick ignore empty
  if (!content.trim()) return;

  let reason = detectViolation(content);

  // link check (only if not already matched)
  const links = extractLinks(content);
  if (!reason && links.length) {
    for (const link of links) {
      if (suspiciousLink(link)) {
        reason = "suspicious_link";
        break;
      }
    }
  }

  // if no rule triggers, still collect conversation memory for conflict detection
  // (lightweight: last 20 messages per channel)
  if (!conversationMemory[message.channel.id]) conversationMemory[message.channel.id] = [];
  conversationMemory[message.channel.id].push({
    userId: message.author.id,
    content,
    url: message.url,
    msgId: message.id,
    channelId: message.channel.id
  });
  if (conversationMemory[message.channel.id].length > 20) conversationMemory[message.channel.id].shift();

  // If nothing suspicious, stop here
  if (!reason) return;

  // AI confirmation (fast + only when triggered)
  const aiLabel = await analyzeMessageAI(content);

  // If AI says SAFE, ignore (reduces false positives)
  if (aiLabel === "SAFE") return;

  violationCount++;
  bumpScores(message.author.id, 1);

  addTimeline(`${aiLabel !== "UNKNOWN" ? aiLabel : reason} from ${message.author.tag} in #${message.channel.name}`);

  const actionRow = buildActionRow({
    messageId: message.id,
    channelId: message.channel.id,
    userId: message.author.id,
    jumpUrl: message.url
  });

  await sendStaffAlert({
    title: "Cornèr AI Alert",
    color: "#ff6ec7",
    fields: [
      { name: "User", value: `<@${message.author.id}>`, inline: true },
      { name: "Channel", value: `<#${message.channel.id}>`, inline: true },
      { name: "Type", value: `${aiLabel !== "UNKNOWN" ? aiLabel : reason}` },
      { name: "Risk Score", value: `${userRisk[message.author.id] || 0}`, inline: true },
      { name: "Trust Score", value: `${userTrust[message.author.id] ?? 100}`, inline: true },
      { name: "Message", value: `${content.slice(0, 200)}\n\n[Jump to message](${message.url})` }
    ],
    actionRow
  });

  /* Conversation conflict detection (simple + cheap):
     if last 10 msgs contain 3+ harassment keywords across 2+ users -> alert */
  try {
    const mem = conversationMemory[message.channel.id] || [];
    const last10 = mem.slice(-10);

    const harshWords = [
      "idiot", "moron", "stupid", "shut up", "kys", "loser"
    ];

    const toxic = last10.filter(m =>
      harshWords.some(w => m.content.toLowerCase().includes(w))
    );

    if (toxic.length >= 3) {
      const users = [...new Set(toxic.map(t => t.userId))];
      if (users.length >= 2) {
        const latest = toxic[toxic.length - 1];

        const row2 = buildActionRow({
          messageId: latest.msgId,
          channelId: latest.channelId,
          userId: latest.userId,
          jumpUrl: latest.url
        });

        addTimeline(`Conversation risk in #${message.channel.name}`);

        await sendStaffAlert({
          title: "Conversation Risk Detected",
          color: "#ff6ec7",
          fields: [
            { name: "Channel", value: `<#${message.channel.id}>` },
            { name: "Users involved", value: users.map(u => `<@${u}>`).join("\n") },
            { name: "Risk", value: "Possible argument / toxic conversation" },
            { name: "Jump", value: `[Jump to message](${latest.url})` }
          ],
          actionRow: row2
        });

        // reset this channel memory to avoid spam alerts
        conversationMemory[message.channel.id] = [];
      }
    }
  } catch (err) {
    console.error("Conversation risk detection failed:", err);
  }
});

/* =========================
   RAID DETECTION + LOCKDOWN
========================= */

client.on("guildMemberAdd", async (member) => {
  try {
    joinTracker.push(Date.now());
    joinTracker = joinTracker.filter(t => Date.now() - t < RAID_WINDOW_MS);

    // suspicious account alert (new account)
    const ageHours = (Date.now() - member.user.createdTimestamp) / 3600000;
    if (ageHours < NEW_ACCOUNT_HOURS) {
      addTimeline(`Suspicious account joined: ${member.user.tag} (${Math.floor(ageHours)}h old)`);

      await sendStaffAlert({
        title: "Suspicious Account",
        color: "#ff6ec7",
        fields: [
          { name: "User", value: `<@${member.id}>`, inline: true },
          { name: "Account Age", value: `${Math.floor(ageHours)} hours`, inline: true },
          { name: "Note", value: "Newly created account" }
        ]
      });
    }

    // raid detection
    if (joinTracker.length >= RAID_JOIN_THRESHOLD) {
      addTimeline("Raid detected (mass joins) — lockdown enabled");

      await sendStaffAlert({
        title: "Raid Protection Activated",
        color: "#ff0000",
        fields: [
          { name: "Reason", value: `>= ${RAID_JOIN_THRESHOLD} joins in ${Math.floor(RAID_WINDOW_MS / 1000)}s` },
          { name: "Action", value: "Lockdown: @everyone cannot send messages" }
        ]
      });

      // Lockdown
      member.guild.channels.cache.forEach(async channel => {
        if (!channel.isTextBased()) return;
        try {
          await channel.permissionOverwrites.edit(
            member.guild.roles.everyone,
            { SendMessages: false }
          );
        } catch {}
      });
    }
  } catch (err) {
    console.error("guildMemberAdd error:", err);
  }
});

/* =========================
   BUTTON HANDLER (Delete / Timeout)
========================= */

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  // staff only
  if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    return interaction.reply({ content: "Staff only.", ephemeral: true });
  }

  // delete
  if (interaction.customId.startsWith("delete_")) {
    const parts = interaction.customId.split("_");
    const msgId = parts[1];
    const channelId = parts[2];

    try {
      const channel = await interaction.guild.channels.fetch(channelId);
      const msg = await channel.messages.fetch(msgId);
      await msg.delete();
      return interaction.reply({ content: "Message deleted.", ephemeral: true });
    } catch (err) {
      console.error("Delete failed:", err);
      return interaction.reply({ content: "Delete failed.", ephemeral: true });
    }
  }

  // timeout
  if (interaction.customId.startsWith("timeout_")) {
    const userId = interaction.customId.split("_")[1];

    try {
      const member = await interaction.guild.members.fetch(userId);
      await member.timeout(10 * 60 * 1000, "Cornèr AI moderation");
      return interaction.reply({ content: "User timed out for 10 minutes.", ephemeral: true });
    } catch (err) {
      console.error("Timeout failed:", err);
      return interaction.reply({ content: "Timeout failed.", ephemeral: true });
    }
  }
});

/* =========================
   COMMAND HANDLER (staff channel only)
========================= */

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // only in staff AI channel
  if (interaction.channel.id !== STAFF_CHANNEL) {
    return interaction.reply({ content: "Use commands in the staff AI channel.", ephemeral: true });
  }

  // staff permission default (moderator+)
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: "Staff only command.", ephemeral: true });
  }

  /* /aicheck */
  if (interaction.commandName === "aicheck") {
    return interaction.reply("Cornèr AI monitoring active.");
  }

  /* /what */
  if (interaction.commandName === "what") {
    const embed = new EmbedBuilder()
      .setColor("#ff6ec7")
      .setTitle("Cornèr AI Capabilities")
      .setDescription(
        [
          "• Real-time monitoring (reads all channels)",
          "• Spam / caps / scam / phishing / harassment / NSFW detection",
          "• Suspicious link detection",
          "• Emoji spam + mass ping detection",
          "• Conversation risk detection (arguments)",
          "• Suspicious account alerts",
          "• Raid detection + lockdown",
          "• Moderation buttons: Delete / Timeout / Jump",
          "• Risk + Trust scoring",
          "• Timeline + Watch + Scan",
          "• AI assistant (/ai)"
        ].join("\n")
      );
    return interaction.reply({ embeds: [embed] });
  }

  /* /ai */
  if (interaction.commandName === "ai") {
    const q = interaction.options.getString("question");

    await interaction.deferReply();

    try {
      if (!process.env.GROQ_KEY) {
        return interaction.editReply("AI is not configured (missing GROQ_KEY).");
      }

      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.GROQ_KEY}`
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [
            { role: "system", content: "You help Discord staff manage and moderate servers. Be clear and practical." },
            { role: "user", content: q }
          ],
          temperature: 0.3
        })
      });

      const data = await res.json();
      const reply = (data?.choices?.[0]?.message?.content || "No response.").trim();

      const embed = new EmbedBuilder()
        .setColor("#ff6ec7")
        .setTitle("Cornèr AI Assistant")
        .addFields(
          { name: "Question", value: q.slice(0, 1024) },
          { name: "Answer", value: reply.slice(0, 1024) }
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error("/ai error:", err);
      return interaction.editReply("AI error.");
    }
  }

  /* /watch */
  if (interaction.commandName === "watch") {
    const guild = interaction.guild;

    const embed = new EmbedBuilder()
      .setColor("#ff6ec7")
      .setTitle("Server Watch")
      .addFields(
        { name: "Members", value: `${guild.memberCount}`, inline: true },
        { name: "Channels", value: `${guild.channels.cache.size}`, inline: true },
        { name: "Alerts logged", value: `${serverTimeline.length}`, inline: true },
        { name: "Monitoring", value: "Active", inline: true }
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  /* /timeline */
  if (interaction.commandName === "timeline") {
    const embed = new EmbedBuilder()
      .setColor("#ff6ec7")
      .setTitle("Server Timeline")
      .setDescription(serverTimeline.slice(0, 25).join("\n") || "No events yet.")
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  /* /stats */
  if (interaction.commandName === "stats") {
    const embed = new EmbedBuilder()
      .setColor("#ff6ec7")
      .setTitle("Moderation Statistics")
      .addFields(
        { name: "Violations detected", value: `${violationCount}`, inline: true },
        { name: "Tracked users", value: `${Object.keys(userRisk).length}`, inline: true }
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  /* /risk */
  if (interaction.commandName === "risk") {
    const user = interaction.options.getUser("member");
    const risk = userRisk[user.id] || 0;

    const embed = new EmbedBuilder()
      .setColor("#ff6ec7")
      .setTitle("Risk Score")
      .addFields(
        { name: "User", value: `<@${user.id}>`, inline: true },
        { name: "Risk", value: `${risk}`, inline: true }
      );

    return interaction.reply({ embeds: [embed] });
  }

  /* /trust */
  if (interaction.commandName === "trust") {
    const user = interaction.options.getUser("member");
    const trust = userTrust[user.id] ?? 100;

    const embed = new EmbedBuilder()
      .setColor("#ff6ec7")
      .setTitle("Trust Score")
      .addFields(
        { name: "User", value: `<@${user.id}>`, inline: true },
        { name: "Trust", value: `${trust}`, inline: true }
      );

    return interaction.reply({ embeds: [embed] });
  }

  /* /user */
  if (interaction.commandName === "user") {
    const user = interaction.options.getUser("member");
    const member = await interaction.guild.members.fetch(user.id);

    const ageHours = (Date.now() - user.createdTimestamp) / 3600000;
    const risk = userRisk[user.id] || 0;
    const trust = userTrust[user.id] ?? 100;

    const embed = new EmbedBuilder()
      .setColor("#ff6ec7")
      .setTitle("User Analysis")
      .addFields(
        { name: "User", value: `<@${user.id}>` },
        { name: "Account Age", value: `${Math.floor(ageHours / 24)} days`, inline: true },
        { name: "Joined Server", value: member.joinedAt ? member.joinedAt.toDateString() : "Unknown", inline: true },
        { name: "Risk", value: `${risk}`, inline: true },
        { name: "Trust", value: `${trust}`, inline: true }
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  /* /scan */
  if (interaction.commandName === "scan") {
    await interaction.deferReply();

    try {
      const msgs = await interaction.channel.messages.fetch({ limit: 50 });

      let counts = {
        spam: 0, caps: 0, scam: 0, phishing: 0, advertising: 0,
        nsfw: 0, harassment: 0, emoji_spam: 0, mass_ping: 0,
        fake_giveaway: 0, suspicious_link: 0
      };

      let examples = [];

      for (const m of msgs.values()) {
        if (m.author.bot) continue;
        if (!m.content) continue;

        let r = detectViolation(m.content);

        const links = extractLinks(m.content);
        if (!r && links.length) {
          for (const link of links) {
            if (suspiciousLink(link)) {
              r = "suspicious_link";
              break;
            }
          }
        }

        if (r) {
          counts[r] = (counts[r] || 0) + 1;
          if (examples.length < 5) {
            examples.push(`[Jump](${m.url}) — <@${m.author.id}> — ${r}`);
          }
        }
      }

      const total = Object.values(counts).reduce((a, b) => a + b, 0);

      const embed = new EmbedBuilder()
        .setColor("#ff6ec7")
        .setTitle("Manual Scan Report")
        .addFields(
          { name: "Channel", value: `<#${interaction.channel.id}>`, inline: true },
          { name: "Messages scanned", value: `${msgs.size}`, inline: true },
          { name: "Flagged", value: `${total}`, inline: true },
          { name: "Breakdown", value: Object.entries(counts).filter(([,v]) => v>0).map(([k,v]) => `• ${k}: ${v}`).join("\n") || "No issues found." },
          { name: "Examples", value: examples.join("\n") || "—" }
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error("/scan error:", err);
      return interaction.editReply("Scan failed.");
    }
  }

  /* /slowmode */
  if (interaction.commandName === "slowmode") {
    try {
      await interaction.channel.setRateLimitPerUser(10);
      return interaction.reply("Slowmode enabled (10s).");
    } catch (err) {
      console.error("/slowmode error:", err);
      return interaction.reply("Slowmode failed.");
    }
  }

  /* /lock */
  if (interaction.commandName === "lock") {
    await interaction.deferReply();

    interaction.guild.channels.cache.forEach(async (channel) => {
      if (!channel.isTextBased()) return;
      try {
        await channel.permissionOverwrites.edit(
          interaction.guild.roles.everyone,
          { SendMessages: false }
        );
      } catch {}
    });

    addTimeline("Manual LOCK activated by staff");
    return interaction.editReply("Server locked.");
  }

  /* /unlock */
  if (interaction.commandName === "unlock") {
    await interaction.deferReply();

    interaction.guild.channels.cache.forEach(async (channel) => {
      if (!channel.isTextBased()) return;
      try {
        await channel.permissionOverwrites.edit(
          interaction.guild.roles.everyone,
          { SendMessages: true }
        );
      } catch {}
    });

    addTimeline("Manual UNLOCK activated by staff");
    return interaction.editReply("Server unlocked.");
  }
});

/* =========================
   LOGIN
========================= */

client.login(process.env.TOKEN);
