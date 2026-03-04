require("dotenv").config();
const fetch = (...args) => import("node-fetch").then(({default: fetch}) => fetch(...args));

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

/*
SERVER MEMORY
Here you define how your server works
*/

const SERVER_CONTEXT = `
Server Name: Cornèr Server

Purpose:
Community Discord server managed by staff.

Staff Roles:
- Moderator
- Admin
- Owner

Moderation Policy:
1. Warn
2. Timeout
3. Kick
4. Ban

General Rules:
- No spam
- No harassment
- Respect staff decisions
- Follow Discord Terms of Service

AI Role:
You are a professional assistant helping the staff manage the server.
You provide moderation advice, explain systems and help staff decisions.
`;

const client = new Client({
intents: [GatewayIntentBits.Guilds]
});

const command = new SlashCommandBuilder()
.setName("ai")
.setDescription("Ask the Cornèr AI staff assistant")
.addStringOption(option =>
option.setName("question")
.setDescription("Your question")
.setRequired(true)
);

client.once("ready", async () => {

console.log("Cornèr AI is online.");

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

try {

await rest.put(
Routes.applicationCommands(client.user.id),
{ body: [command.toJSON()] }
);

console.log("Slash command registered.");

} catch (error) {
console.error(error);
}

});

client.on("interactionCreate", async interaction => {

if (!interaction.isChatInputCommand()) return;

if (interaction.commandName === "ai") {

if (interaction.channel.id !== STAFF_CHANNEL) {
return interaction.reply({
content: "This command can only be used in the staff AI channel.",
ephemeral: true
});
}

if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
return interaction.reply({
content: "You must be staff to use this command.",
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
{
role: "system",
content: SERVER_CONTEXT
},
{
role: "user",
content: question
}
]
})
});

const data = await response.json();

if (!data.choices) {
console.log(data);
return interaction.editReply("AI error. Check API key.");
}

let reply = data.choices[0].message.content;

if (reply.length > 3500) {
reply = reply.substring(0, 3500) + "...";
}

const embed = new EmbedBuilder()
.setColor("#ff6ec7")
.setAuthor({
name: "Cornèr AI Assistant",
iconURL: client.user.displayAvatarURL()
})
.setThumbnail(client.user.displayAvatarURL())
.addFields(
{
name: "Staff Question",
value: `> ${question}`
},
{
name: "AI Response",
value: reply
}
)
.setFooter({
text: `Requested by ${interaction.user.username}`
})
.setTimestamp();

interaction.editReply({ embeds: [embed] });

} catch (error) {

console.error(error);

interaction.editReply("AI error. Try again later.");

}

}

});

client.login(process.env.TOKEN);
