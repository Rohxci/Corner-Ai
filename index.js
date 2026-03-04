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

const client = new Client({
intents: [
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.MessageContent,
GatewayIntentBits.GuildMembers
]
});

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
.setDescription("Scan server chats and members for suspicious activity")

];

client.once("ready", async () => {

console.log("Cornèr AI is online.");

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

await rest.put(
Routes.applicationCommands(client.user.id),
{ body: commands.map(c => c.toJSON()) }
);

console.log("Commands registered.");

});

client.on("interactionCreate", async interaction => {

if (!interaction.isChatInputCommand()) return;

/* ================= AI ================= */

if (interaction.commandName === "ai") {

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
{ role: "system", content: "You help Discord staff with moderation and server management." },
{ role: "user", content: question }
]
})
});

const data = await response.json();

let reply = data.choices[0].message.content;

const embed = new EmbedBuilder()
.setColor("#ff6ec7")
.setAuthor({ name: "Cornèr AI Assistant", iconURL: client.user.displayAvatarURL() })
.addFields(
{ name: "Question", value: question },
{ name: "Answer", value: reply.substring(0, 1024) }
)
.setFooter({ text: `Requested by ${interaction.user.username}` })
.setTimestamp();

interaction.editReply({ embeds: [embed] });

} catch (err) {

console.error(err);
interaction.editReply("AI error.");

}

}

/* ================= AICHECK ================= */

if (interaction.commandName === "aicheck") {

if (interaction.channel.id !== STAFF_CHANNEL) {
return interaction.reply({
content: "Use this command in the staff AI channel.",
ephemeral: true
});
}

await interaction.deferReply();

const suspiciousUsers = new Set();
let suspiciousLinks = 0;

/* scan all channels automatically */

for (const channel of interaction.guild.channels.cache.values()) {

if (!channel.isTextBased()) continue;

if (channel.id === STAFF_CHANNEL) continue;

try {

const messages = await channel.messages.fetch({ limit: 25 });

messages.forEach(msg => {

if (msg.author.bot) return;

const content = msg.content.toLowerCase();

/* link detection */

if (content.includes("http")) {

try {

const url = new URL(content.split("http")[1].split(" ")[0]);
const domain = url.hostname;

if (!SAFE_DOMAINS.some(d => domain.includes(d))) {

suspiciousLinks++;
suspiciousUsers.add(msg.author);

}

} catch {}

}

/* spam detection */

if (content.length > 20 && content === content.toUpperCase()) {
suspiciousUsers.add(msg.author);
}

});

} catch {}

}

/* member check */

const members = await interaction.guild.members.fetch();

const newAccounts = [];

members.forEach(member => {

const ageHours = (Date.now() - member.user.createdTimestamp) / 3600000;

if (ageHours < 48) {
newAccounts.push(member);
}

});

/* raid detection */

const recentJoins = members.filter(m => {

if (!m.joinedTimestamp) return false;

const minutes = (Date.now() - m.joinedTimestamp) / 60000;

return minutes < 30;

});

const raidRisk = recentJoins.size > 5 ? "Medium" : "Low";

const embed = new EmbedBuilder()
.setColor("#ff6ec7")
.setAuthor({ name: "Cornèr AI Security Check", iconURL: client.user.displayAvatarURL() })
.addFields(
{ name: "Suspicious Links", value: suspiciousLinks.toString(), inline: true },
{ name: "Raid Risk", value: raidRisk, inline: true },
{
name: "Users involved",
value: [...suspiciousUsers].map(u => `<@${u.id}>`).join("\n") || "None"
},
{
name: "New accounts",
value: newAccounts.slice(0,5).map(m => `<@${m.id}>`).join("\n") || "None"
}
)
.setFooter({ text: `Requested by ${interaction.user.username}` })
.setTimestamp();

interaction.editReply({ embeds: [embed] });

}

});

client.login(process.env.TOKEN);
