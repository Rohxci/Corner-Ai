require("dotenv").config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, PermissionFlagsBits } = require("discord.js");
const OpenAI = require("openai");

const STAFF_CHANNEL = "1478869019783335957";

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_KEY
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
        content: "You must be a staff member to use this command.",
        ephemeral: true
      });
    }

    const question = interaction.options.getString("question");

    await interaction.deferReply();

    try {

      const response = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: "You are a technical assistant helping Discord server staff with moderation, bots, and server management."
          },
          {
            role: "user",
            content: question
          }
        ]
      });

      const reply = response.choices[0].message.content;

      interaction.editReply(reply);

    } catch (error) {

      console.error(error);

      interaction.editReply("AI error. Please try again later.");

    }

  }

});

client.login(process.env.TOKEN);
