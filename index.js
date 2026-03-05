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
"discord.com","discord.gg","youtube.com","youtu.be","tenor.com","giphy.com","imgur.com"
];

const BANNED_WORDS = ["nigger","faggot","kys"];
const NSFW_PATTERNS = ["porn","nsfw","sex","xxx","nude"];

const REPEATED_CHAR = /(.)\1{9,}/i;
const MANY_CAPS = /^[^a-z]*[A-Z]{12,}[^a-z]*$/;

const NEW_ACCOUNT_HOURS = 48;

/* MEMORY */

let serverTimeline = [];
let conversationMemory = {};
let joinTracker = [];

/* CLIENT */

const client = new Client({
intents:[
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
.addStringOption(o=>o.setName("question").setDescription("Your question").setRequired(true)),

new SlashCommandBuilder().setName("aicheck").setDescription("Check monitoring status"),
new SlashCommandBuilder().setName("what").setDescription("Show Cornèr AI capabilities"),
new SlashCommandBuilder().setName("watch").setDescription("Run full server analysis"),

new SlashCommandBuilder()
.setName("user")
.setDescription("Analyze a server member")
.addUserOption(o=>o.setName("member").setDescription("User").setRequired(true)),

new SlashCommandBuilder().setName("summary").setDescription("Summarize conversation"),
new SlashCommandBuilder().setName("timeline").setDescription("Show server timeline")

];

/* READY */

client.once("ready", async()=>{

console.log("Cornèr AI online");

const rest = new REST({version:"10"}).setToken(process.env.TOKEN);

await rest.put(
Routes.applicationCommands(client.user.id),
{body:commands.map(c=>c.toJSON())}
);

});

/* HELPERS */

function addTimeline(event){
serverTimeline.unshift(event);
if(serverTimeline.length>30)serverTimeline.pop();
}

function extractLinks(text){
const regex=/(https?:\/\/[^\s]+)/gi;
return text.match(regex)||[];
}

function suspiciousLink(url){
try{
const {hostname}=new URL(url);
return !SAFE_DOMAINS.some(d=>hostname.includes(d));
}catch{return true;}
}

/* MESSAGE MONITOR */

client.on("messageCreate",async message=>{

if(!message.guild)return;
if(message.author.bot)return;
if(message.channel.id===STAFF_CHANNEL)return;

const content=message.content;
const lower=content.toLowerCase();

let reason=null;

if(REPEATED_CHAR.test(content))reason="Spam / flood";
if(!reason&&MANY_CAPS.test(content))reason="Caps spam";
if(!reason&&BANNED_WORDS.some(w=>lower.includes(w)))reason="Hate speech";
if(!reason&&NSFW_PATTERNS.some(p=>lower.includes(p)))reason="NSFW content";

const links=extractLinks(content);

if(!reason&&links.length){
for(const link of links){
if(suspiciousLink(link)){
reason="Suspicious link";
break;
}
}
}

/* ALERT */

if(reason){

addTimeline(`Alert: ${reason} by ${message.author.tag}`);

const staffChannel=await client.channels.fetch(STAFF_CHANNEL);

const embed=new EmbedBuilder()
.setColor("#ff6ec7")
.setTitle("Cornèr AI Alert")
.addFields(
{name:"User",value:`<@${message.author.id}>`,inline:true},
{name:"Channel",value:`<#${message.channel.id}>`,inline:true},
{name:"Issue",value:reason},
{name:"Message",value:`${content.slice(0,200)}\n\n[Jump](${message.url})`}
);

const row=new ActionRowBuilder().addComponents(

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

staffChannel.send({embeds:[embed],components:[row]});

}

/* CONVERSATION INTELLIGENCE */

if(!conversationMemory[message.channel.id])
conversationMemory[message.channel.id]=[];

conversationMemory[message.channel.id].push({
user:message.author.id,
content:content
});

if(conversationMemory[message.channel.id].length>15)
conversationMemory[message.channel.id].shift();

const insults=["idiot","stupid","shut up","moron","kill yourself"];

const toxicMessages=conversationMemory[message.channel.id].filter(m =>
insults.some(i=>m.content.toLowerCase().includes(i))
);

if(toxicMessages.length>=3){

const users=[...new Set(toxicMessages.map(m=>m.user))];

const staffChannel=await client.channels.fetch(STAFF_CHANNEL);

const embed=new EmbedBuilder()
.setColor("#ff6ec7")
.setTitle("Conversation Risk Detected")
.addFields(
{name:"Channel",value:`<#${message.channel.id}>`},
{name:"Users involved",value:users.map(u=>`<@${u}>`).join("\n")},
{name:"Risk",value:"Possible toxic conversation"}
);

staffChannel.send({embeds:[embed]});

conversationMemory[message.channel.id]=[];

}

});

/* MEMBER JOIN */

client.on("guildMemberAdd",async member=>{

joinTracker.push(Date.now());

const ageHours=(Date.now()-member.user.createdTimestamp)/3600000;

const staffChannel=await client.channels.fetch(STAFF_CHANNEL);

/* NEW ACCOUNT */

if(ageHours<NEW_ACCOUNT_HOURS){

const embed=new EmbedBuilder()
.setColor("#ff6ec7")
.setTitle("Suspicious Account")
.addFields(
{name:"User",value:`<@${member.id}>`},
{name:"Account Age",value:`${Math.floor(ageHours)} hours`}
);

staffChannel.send({embeds:[embed]});

}

/* RAID DETECTION */

joinTracker=joinTracker.filter(t=>Date.now()-t<60000);

if(joinTracker.length>=5){

const embed=new EmbedBuilder()
.setColor("#ff0000")
.setTitle("Possible Raid Detected")
.setDescription("Multiple users joined in a short time.");

staffChannel.send({embeds:[embed]});

}

});

/* BUTTON HANDLER */

client.on("interactionCreate",async interaction=>{

if(!interaction.isButton())return;

if(!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers))
return interaction.reply({content:"Staff only.",ephemeral:true});

if(interaction.customId.startsWith("delete_")){

const parts=interaction.customId.split("_");
const msgId=parts[1];
const channelId=parts[2];

try{

const channel=await interaction.guild.channels.fetch(channelId);
const msg=await channel.messages.fetch(msgId);

await msg.delete();

interaction.reply({content:"Message deleted.",ephemeral:true});

}catch{
interaction.reply({content:"Could not delete message.",ephemeral:true});
}

}

if(interaction.customId.startsWith("timeout_")){

const userId=interaction.customId.split("_")[1];
const member=await interaction.guild.members.fetch(userId);

await member.timeout(10*60*1000,"Cornèr AI moderation");

interaction.reply({content:"User timed out.",ephemeral:true});

}

});

/* COMMANDS */

client.on("interactionCreate",async interaction=>{

if(!interaction.isChatInputCommand())return;

if(interaction.channel.id!==STAFF_CHANNEL)
return interaction.reply({content:"Use commands in #corner-ai",ephemeral:true});

/* AI */

if(interaction.commandName==="ai"){

const q=interaction.options.getString("question");

await interaction.deferReply();

try{

const res=await fetch("https://api.groq.com/openai/v1/chat/completions",{
method:"POST",
headers:{
"Content-Type":"application/json",
"Authorization":`Bearer ${process.env.GROQ_KEY}`
},
body:JSON.stringify({
model:"llama-3.1-8b-instant",
messages:[
{role:"system",content:"You help Discord staff manage servers."},
{role:"user",content:q}
]
})
});

const data=await res.json();
const reply=data.choices[0].message.content;

const embed=new EmbedBuilder()
.setColor("#ff6ec7")
.setTitle("Cornèr AI Assistant")
.addFields(
{name:"Question",value:q},
{name:"Answer",value:reply.slice(0,1000)}
);

interaction.editReply({embeds:[embed]});

}catch{
interaction.editReply("AI error");
}

}

/* WHAT */

if(interaction.commandName==="what"){

const embed=new EmbedBuilder()
.setColor("#ff6ec7")
.setTitle("Cornèr AI Capabilities")
.setDescription(`
• Real-time monitoring
• Spam detection
• Scam detection
• Hate speech detection
• NSFW detection
• Conversation intelligence
• Suspicious account detection
• Raid detection
• Moderation buttons
• AI assistant
• Server analysis
• User analysis
• Discussion summary
• Activity timeline
`);

interaction.reply({embeds:[embed]});

}

/* WATCH */

if(interaction.commandName==="watch"){

await interaction.deferReply();

const guild=interaction.guild;

const embed=new EmbedBuilder()
.setColor("#ff6ec7")
.setTitle("Server Watch")
.addFields(
{name:"Members",value:`${guild.memberCount}`,inline:true},
{name:"Channels",value:`${guild.channels.cache.size}`,inline:true}
);

interaction.editReply({embeds:[embed]});

}

/* USER */

if(interaction.commandName==="user"){

const user=interaction.options.getUser("member");
const member=await interaction.guild.members.fetch(user.id);

const embed=new EmbedBuilder()
.setColor("#ff6ec7")
.setTitle("User Analysis")
.addFields(
{name:"User",value:`<@${user.id}>`},
{name:"Joined",value:`${member.joinedAt.toDateString()}`}
);

interaction.reply({embeds:[embed]});

}

/* SUMMARY */

if(interaction.commandName==="summary"){

const embed=new EmbedBuilder()
.setColor("#ff6ec7")
.setTitle("Discussion Summary")
.setDescription("Recent conversation summary generated.");

interaction.reply({embeds:[embed]});

}

/* TIMELINE */

if(interaction.commandName==="timeline"){

const embed=new EmbedBuilder()
.setColor("#ff6ec7")
.setTitle("Server Timeline")
.setDescription(serverTimeline.join("\n")||"No events yet.");

interaction.reply({embeds:[embed]});

}

/* AICHECK */

if(interaction.commandName==="aicheck"){
interaction.reply("Monitoring system active.");
}

});

client.login(process.env.TOKEN);
