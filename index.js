require("dotenv").config();
const fetch = (...args) => import("node-fetch").then(({default: fetch}) => fetch(...args));

const { 
Client, 
GatewayIntentBits, 
SlashCommandBuilder, 
REST, 
Routes, 
PermissionFlagsBits 
} = require("discord.js");

const STAFF_CHANNEL = "1478869019783335957";

const client = new Client({
intents: [GatewayIntentBits.Guilds]
});

const command = new SlashCommandBuilder()
.setName("ai")
.setDescription("Ask the staff AI assistant")
.addStringOption(option =>
option.setName("question")
.setDescription("Your question")
.setRequired(true)
);

client.once("ready", async () => {

console.log("Corner AI is online.");

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
content: "You are a technical assistant helping Discord server staff with moderation and server management."
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

const reply = data.choices[0].message.content;

interaction.editReply(reply);

} catch (error) {

console.error(error);

interaction.editReply("AI error. Try again later.");

}

}

});

client.login(process.env.TOKEN);
