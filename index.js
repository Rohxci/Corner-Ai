require("dotenv").config();
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  EmbedBuilder
} = require("discord.js");

/* ========= CONFIG ========= */

const STAFF_CHANNEL = "1478869019783335957"; // #corner-ai

// Domini considerati sicuri
const SAFE_DOMAINS = [
  "discord.com",
  "discord.gg",
  "youtube.com",
  "youtu.be",
  "tenor.com",
  "giphy.com",
  "imgur.com",
  "twitter.com",
  "x.com",
  "twitch.tv"
];

// parole molto offensive (modificabili)
const BANNED_WORDS = [
  "nigger",
  "faggot",
  "kys",
  "retard"
];

// pattern NSFW semplici
const NSFW_PATTERNS = [
  "porn",
  "nsfw",
  "nude",
  "sex",
  "xxx"
];

// spam patterns
const REPEATED_CHAR = /(.)\1{9,}/i;
const MANY_CAPS = /^[^a-z]*[A-Z]{12,}[^a-z]*$/;

// raid detection
const NEW_ACCOUNT_HOURS = 48;
const RAID_WINDOW_MIN = 30;
const RAID_THRESHOLD = 5;

/* ========= CLIENT ========= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

/* ========= COMMANDS ========= */

const commands = [

  new SlashCommandBuilder()
    .setName("ai")
    .setDescription("Ask the Cornèr AI assistant")
    .addStringOption(option =>
      option.setName("question")
        .setDescription("Your question")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("aicheck")
    .setDescription("Run a full server security audit")

];

/* ========= READY ========= */

client.once("ready", async () => {

  console.log("Cornèr AI is online.");

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands.map(c => c.toJSON()) }
  );

  console.log("Commands registered.");

});

/* ========= HELPERS ========= */

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

/* ========= AUTOWATCH ========= */

client.on("messageCreate", async message => {

  if (!message.guild) return;
  if (message.author.bot) return;
  if (message.channel.id === STAFF_CHANNEL) return;

  if (message.member.permissions.has(PermissionFlagsBits.ManageGuild)) return;

  const content = message.content;
  const lower = content.toLowerCase();

  let reason = null;

  /* spam */

  if (REPEATED_CHAR.test(content)) {
    reason = "Spam / flood";
  }

  if (!reason && MANY_CAPS.test(content)) {
    reason = "Caps spam";
  }

  /* hate speech */

  if (!reason && BANNED_WORDS.some(w => lower.includes(w))) {
    reason = "Hate speech";
  }

  /* NSFW */

  if (!reason && NSFW_PATTERNS.some(p => lower.includes(p))) {
    reason = "NSFW / sexual content";
  }

  /* suspicious links */

  const links = extractLinks(content);

  if (!reason && links.length) {
    for (const link of links) {
      if (suspiciousLink(link)) {
        reason = "Suspicious link";
        break;
      }
    }
  }

  if (!reason) return;

  const staffChannel = await client.channels.fetch(STAFF_CHANNEL);

  const embed = new EmbedBuilder()
    .setColor("#ff6ec7")
    .setAuthor({
      name: "Cornèr AI Rule Alert",
      iconURL: client.user.displayAvatarURL()
    })
    .addFields(
      { name: "User", value: `<@${message.author.id}>`, inline: true },
      { name: "Channel", value: `<#${message.channel.id}>`, inline: true },
      { name: "Issue", value: reason },
      { name: "Message", value: content.substring(0, 1000) }
    )
    .setTimestamp();

  staffChannel.send({ embeds: [embed] });

});

/* ========= MEMBER WATCH ========= */

client.on("guildMemberAdd", async member => {

  const staffChannel = await client.channels.fetch(STAFF_CHANNEL);

  const accountAgeHours =
    (Date.now() - member.user.createdTimestamp) / 3600000;

  if (accountAgeHours < NEW_ACCOUNT_HOURS) {

    const embed = new EmbedBuilder()
      .setColor("#ff6ec7")
      .setAuthor({
        name: "Cornèr AI Suspicious Account",
        iconURL: client.user.displayAvatarURL()
      })
      .addFields(
        { name: "User", value: `<@${member.id}>` },
        { name: "Account Age", value: `${Math.floor(accountAgeHours)} hours` },
        { name: "Risk", value: "Very new account" }
      )
      .setTimestamp();

    staffChannel.send({ embeds: [embed] });

  }

});

/* ========= COMMAND HANDLER ========= */

client.on("interactionCreate", async interaction => {

  if (!interaction.isChatInputCommand()) return;

  if (interaction.channel.id !== STAFF_CHANNEL) {
    return interaction.reply({
      content: "Use this command in the staff AI channel.",
      ephemeral: true
    });
  }

  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: "Staff only command.",
      ephemeral: true
    });
  }

  /* ===== AI ===== */

  if (interaction.commandName === "ai") {

    const question = interaction.options.getString("question");

    await interaction.deferReply();

    try {

      const response = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.GROQ_KEY}`
          },
          body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [
              { role: "system", content: "You help Discord staff with moderation." },
              { role: "user", content: question }
            ]
          })
        }
      );

      const data = await response.json();

      const reply = data.choices[0].message.content;

      const embed = new EmbedBuilder()
        .setColor("#ff6ec7")
        .setAuthor({
          name: "Cornèr AI Assistant",
          iconURL: client.user.displayAvatarURL()
        })
        .addFields(
          { name: "Question", value: question },
          { name: "Answer", value: reply.substring(0, 1024) }
        )
        .setTimestamp();

      interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error(err);
      interaction.editReply("AI error.");
    }

  }

  /* ===== AICHECK ===== */

  if (interaction.commandName === "aicheck") {

    await interaction.deferReply();

    const suspiciousUsers = new Set();

    let spam = 0;
    let hate = 0;
    let nsfw = 0;
    let links = 0;

    for (const channel of interaction.guild.channels.cache.values()) {

      if (!channel.isTextBased()) continue;
      if (channel.id === STAFF_CHANNEL) continue;

      try {

        const messages = await channel.messages.fetch({ limit: 25 });

        messages.forEach(msg => {

          if (msg.author.bot) return;

          const text = msg.content.toLowerCase();

          if (REPEATED_CHAR.test(text) || MANY_CAPS.test(text)) {
            spam++;
            suspiciousUsers.add(msg.author);
          }

          if (BANNED_WORDS.some(w => text.includes(w))) {
            hate++;
            suspiciousUsers.add(msg.author);
          }

          if (NSFW_PATTERNS.some(w => text.includes(w))) {
            nsfw++;
            suspiciousUsers.add(msg.author);
          }

          const foundLinks = extractLinks(text);

          if (foundLinks.length) {

            for (const link of foundLinks) {

              if (suspiciousLink(link)) {
                links++;
                suspiciousUsers.add(msg.author);
              }

            }

          }

        });

      } catch {}

    }

    const members = await interaction.guild.members.fetch();

    const newAccounts = [];

    members.forEach(member => {

      const age =
        (Date.now() - member.user.createdTimestamp) / 3600000;

      if (age < NEW_ACCOUNT_HOURS) {
        newAccounts.push(member);
      }

    });

    const recentJoins = members.filter(m => {

      if (!m.joinedTimestamp) return false;

      const minutes = (Date.now() - m.joinedTimestamp) / 60000;

      return minutes < RAID_WINDOW_MIN;

    });

    const raidRisk =
      recentJoins.size >= RAID_THRESHOLD ? "Medium / Possible raid" : "Low";

    const embed = new EmbedBuilder()
      .setColor("#ff6ec7")
      .setAuthor({
        name: "Cornèr AI Full Security Audit",
        iconURL: client.user.displayAvatarURL()
      })
      .addFields(
        { name: "Spam / Flood", value: spam.toString(), inline: true },
        { name: "Hate Speech", value: hate.toString(), inline: true },
        { name: "NSFW", value: nsfw.toString(), inline: true },
        { name: "Suspicious Links", value: links.toString(), inline: true },
        { name: "Raid Risk", value: raidRisk, inline: true },
        {
          name: "Users involved",
          value: [...suspiciousUsers].map(u => `<@${u.id}>`).join("\n") || "None"
        },
        {
          name: "New Accounts",
          value: newAccounts.slice(0,5).map(m => `<@${m.id}>`).join("\n") || "None"
        }
      )
      .setTimestamp();

    interaction.editReply({ embeds: [embed] });

  }

});

client.login(process.env.TOKEN);
