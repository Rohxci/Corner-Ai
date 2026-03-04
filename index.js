require("dotenv").config();
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

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

/* CONFIG */

const STAFF_CHANNEL = "1478869019783335957";

const SAFE_DOMAINS = [
"discord.com",
"discord.gg",
"youtube.com",
"youtu.be",
"tenor.com",
"giphy.com",
"imgur.com"
];

const BANNED_WORDS = [
"nigger",
"faggot",
"kys"
];

const NSFW_PATTERNS = [
"porn",
"nsfw",
"sex",
"xxx",
"nude"
];

const REPEATED_CHAR = /(.)\1{9,}/i;
const MANY_CAPS = /^[^a-z]*[A-Z]{12,}[^a-z]*$/;

const NEW_ACCOUNT_HOURS = 48;

/* CLIENT */

const client = new Client({
intents: [
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.MessageContent,
GatewayIntentBits.GuildMembers
]
});

/* COMMANDS */

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
.setDescription("Run a server security audit")

];

/* READY */

client.once("ready", async () => {

console.log("Cornèr AI is online.");

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

await rest.put(
Routes.applicationCommands(client.user.id),
{ body: commands.map(c => c.toJSON()) }
);

console.log("Commands registered.");

});

/* HELPERS */

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

/* AUTOWATCH */

client.on("messageCreate", async message => {

if (!message.guild) return;
if (message.author.bot) return;
if (message.channel.id === STAFF_CHANNEL) return;

if (message.member.permissions.has(PermissionFlagsBits.ManageGuild)) return;

const content = message.content;
const lower = content.toLowerCase();

let reason = null;

if (REPEATED_CHAR.test(content)) reason = "Spam / flood";

if (!reason && MANY_CAPS.test(content)) reason = "Caps spam";

if (!reason && BANNED_WORDS.some(w => lower.includes(w)))
reason = "Hate speech";

if (!reason && NSFW_PATTERNS.some(p => lower.includes(p)))
reason = "NSFW content";

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
{
name: "Message",
value: `${content.substring(0,200)}\n\n[Jump to message](${message.url})`
}
)
.setTimestamp();

const row = new ActionRowBuilder()
.addComponents(
new ButtonBuilder()
.setCustomId(`delete_${message.id}_${message.channel.id}`)
.setLabel("Delete Message")
.setStyle(ButtonStyle.Danger),

new ButtonBuilder()
.setCustomId(`timeout_${message.author.id}`)
.setLabel("Timeout 10m")
.setStyle(ButtonStyle.Secondary),

new ButtonBuilder()
.setLabel("Jump to Message")
.setStyle(ButtonStyle.Link)
.setURL(message.url)
);

staffChannel.send({
embeds: [embed],
components: [row]
});

});

/* MEMBER CHECK */

client.on("guildMemberAdd", async member => {

const staffChannel = await client.channels.fetch(STAFF_CHANNEL);

const ageHours =
(Date.now() - member.user.createdTimestamp) / 3600000;

if (ageHours < NEW_ACCOUNT_HOURS) {

const embed = new EmbedBuilder()
.setColor("#ff6ec7")
.setAuthor({
name: "Cornèr AI Suspicious Account",
iconURL: client.user.displayAvatarURL()
})
.addFields(
{ name: "User", value: `<@${member.id}>` },
{ name: "Account Age", value: `${Math.floor(ageHours)} hours` },
{ name: "Risk", value: "Very new account" }
)
.setTimestamp();

staffChannel.send({ embeds: [embed] });

}

});

/* BUTTON HANDLER */

client.on("interactionCreate", async interaction => {

if (!interaction.isButton()) return;

if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
return interaction.reply({ content: "Staff only.", ephemeral: true });
}

if (interaction.customId.startsWith("delete_")) {

const parts = interaction.customId.split("_");
const messageId = parts[1];
const channelId = parts[2];

try {

const channel = await interaction.guild.channels.fetch(channelId);
const msg = await channel.messages.fetch(messageId);

await msg.delete();

interaction.reply({
content: "Message deleted.",
ephemeral: true
});

} catch {

interaction.reply({
content: "Could not delete message.",
ephemeral: true
});

}

}

if (interaction.customId.startsWith("timeout_")) {

const userId = interaction.customId.split("_")[1];
const member = await interaction.guild.members.fetch(userId);

await member.timeout(10 * 60 * 1000, "Cornèr AI moderation");

interaction.reply({
content: "User timed out for 10 minutes.",
ephemeral: true
});

}

});

/* COMMAND HANDLER */

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

/* AI */

if (interaction.commandName === "ai") {

const question = interaction.options.getString("question");

await interaction.deferReply();

try {

const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
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
});

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
{ name: "Answer", value: reply.substring(0,1024) }
)
.setTimestamp();

interaction.editReply({ embeds: [embed] });

} catch {

interaction.editReply("AI error.");

}

}

/* AICHECK */

if (interaction.commandName === "aicheck") {

await interaction.reply("Full server monitoring is active.");

}

});

client.login(process.env.TOKEN);
