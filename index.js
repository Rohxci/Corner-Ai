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

/* CONFIG */

const STAFF_CHANNEL = "1478869019783335957";
const NEW_ACCOUNT_HOURS = 48;

const RAID_JOIN_THRESHOLD = 5;
const RAID_WINDOW_MS = 60000;

const SAFE_DOMAINS = [
"discord.com",
"discord.gg",
"youtube.com",
"youtu.be",
"tenor.com",
"giphy.com",
"imgur.com"
];

/* MEMORY */

let serverTimeline = [];
let conversationMemory = {};
let joinTracker = [];

let userRisk = {};
let userTrust = {};

let violationCount = 0;

/* CLIENT */

const client = new Client({
intents:[
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.MessageContent,
GatewayIntentBits.GuildMembers
]
});

/* VIOLATION PATTERNS */

const VIOLATIONS = {

spam:[
/(.)\1{8,}/i,
/(.)\1{10,}/i,
/(.)\1{12,}/i,
/spam/i,
/buy now/i,
/limited offer/i,
/cheap price/i,
/earn money fast/i
],

caps:[
/^[^a-z]*[A-Z]{12,}[^a-z]*$/,
/^[^a-z]*[A-Z]{15,}[^a-z]*$/,
/^[^a-z]*[A-Z]{20,}[^a-z]*$/
],

scam:[
/free nitro/i,
/nitro giveaway/i,
/claim nitro/i,
/steam gift/i,
/gift card/i,
/crypto reward/i,
/airdrop/i
],

phishing:[
/verify account/i,
/confirm password/i,
/security check/i,
/account locked/i,
/login required/i
],

advertising:[
/subscribe now/i,
/check my channel/i,
/promo code/i,
/visit my website/i
],

nsfw:[
/porn/i,
/xxx/i,
/nsfw/i,
/explicit/i
],

harassment:[
/idiot/i,
/moron/i,
/stupid/i,
/shut up/i,
/loser/i
],

emoji_spam:[
/(\p{Emoji}){10,}/u,
/(\p{Emoji}){15,}/u
],

mass_ping:[
/@everyone/i,
/@here/i
],

fake_giveaway:[
/free giveaway/i,
/instant reward/i,
/lucky winner/i
]

};

/* COMMANDS */

const commands=[

new SlashCommandBuilder()
.setName("ai")
.setDescription("Ask Cornèr AI")
.addStringOption(o=>o.setName("question").setRequired(true)),

new SlashCommandBuilder().setName("what").setDescription("Show capabilities"),
new SlashCommandBuilder().setName("watch").setDescription("Server overview"),
new SlashCommandBuilder().setName("timeline").setDescription("Server timeline"),

new SlashCommandBuilder()
.setName("user")
.setDescription("Analyze user")
.addUserOption(o=>o.setName("member").setRequired(true)),

new SlashCommandBuilder()
.setName("risk")
.setDescription("Check user risk")
.addUserOption(o=>o.setName("member").setRequired(true)),

new SlashCommandBuilder()
.setName("trust")
.setDescription("Check user trust")
.addUserOption(o=>o.setName("member").setRequired(true)),

new SlashCommandBuilder().setName("stats").setDescription("Moderation statistics"),
new SlashCommandBuilder().setName("scan").setDescription("Scan channel"),
new SlashCommandBuilder().setName("lock").setDescription("Lock server"),
new SlashCommandBuilder().setName("unlock").setDescription("Unlock server"),
new SlashCommandBuilder().setName("slowmode").setDescription("Enable slowmode"),
new SlashCommandBuilder().setName("aicheck").setDescription("Check AI system")

];

/* READY */

client.once("ready",async()=>{

console.log("Cornèr AI v5 online");

const rest=new REST({version:"10"}).setToken(process.env.TOKEN);

await rest.put(
Routes.applicationCommands(client.user.id),
{body:commands.map(c=>c.toJSON())}
);

});

/* HELPERS */

function addTimeline(event){
serverTimeline.unshift(event);
if(serverTimeline.length>80)serverTimeline.pop();
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

function detectViolation(text){

for(const type in VIOLATIONS){

for(const pattern of VIOLATIONS[type]){

if(pattern.test(text)) return type;

}

}

return null;

}

/* AI ANALYSIS */

async function analyzeMessage(content){

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
{
role:"system",
content:"Classify message: SAFE, SPAM, SCAM, HARASSMENT, NSFW, RAID."
},
{role:"user",content}
]

})

});

const data=await res.json();

return data.choices[0].message.content;

}catch{

return "SAFE";

}

}

/* MESSAGE MONITOR */

client.on("messageCreate",async message=>{

if(!message.guild) return;
if(message.author.bot) return;
if(message.channel.id===STAFF_CHANNEL) return;

const content = message.content;

let reason = detectViolation(content);

/* LINK DETECTION */

const links = extractLinks(content);

if(!reason && links.length){

for(const link of links){

if(suspiciousLink(link)){
reason="suspicious_link";
break;
}

}

}

if(reason){

const aiResult = await analyzeMessage(content);

if(aiResult==="SAFE") return;

violationCount++;

userRisk[message.author.id]=(userRisk[message.author.id]||0)+1;
userTrust[message.author.id]=(userTrust[message.author.id]||100)-5;

addTimeline(`${aiResult} detected from ${message.author.tag}`);

const staffChannel = await client.channels.fetch(STAFF_CHANNEL);

const embed = new EmbedBuilder()

.setColor("#ff6ec7")

.setTitle("Cornèr AI Alert")

.addFields(
{name:"User",value:`<@${message.author.id}>`,inline:true},
{name:"Channel",value:`<#${message.channel.id}>`,inline:true},
{name:"Type",value:aiResult},
{name:"Risk Score",value:`${userRisk[message.author.id]}`},
{name:"Trust Score",value:`${userTrust[message.author.id]}`},
{name:"Message",value:`${content.slice(0,200)}\n\n[Jump to message](${message.url})`}
);

const row=new ActionRowBuilder().addComponents(

new ButtonBuilder()
.setCustomId(`delete_${message.id}_${message.channel.id}`)
.setLabel("Delete")
.setStyle(ButtonStyle.Danger),

new ButtonBuilder()
.setCustomId(`timeout_${message.author.id}`)
.setLabel("Timeout 10m")
.setStyle(ButtonStyle.Secondary),

new ButtonBuilder()
.setLabel("Jump")
.setStyle(ButtonStyle.Link)
.setURL(message.url)

);

staffChannel.send({embeds:[embed],components:[row]});

}

/* CONVERSATION MEMORY */

if(!conversationMemory[message.channel.id])
conversationMemory[message.channel.id]=[];

conversationMemory[message.channel.id].push(content);

if(conversationMemory[message.channel.id].length>20)
conversationMemory[message.channel.id].shift();

});

/* RAID DETECTION */

client.on("guildMemberAdd",async member=>{

joinTracker.push(Date.now());

joinTracker = joinTracker.filter(t=>Date.now()-t<RAID_WINDOW_MS);

if(joinTracker.length>=RAID_JOIN_THRESHOLD){

addTimeline("Raid detected");

const staffChannel=await client.channels.fetch(STAFF_CHANNEL);

const embed=new EmbedBuilder()

.setColor("#ff0000")

.setTitle("Raid Protection")

.setDescription("Mass joins detected. Lockdown enabled.");

staffChannel.send({embeds:[embed]});

member.guild.channels.cache.forEach(async channel=>{

if(channel.isTextBased()){

try{
await channel.permissionOverwrites.edit(
member.guild.roles.everyone,
{SendMessages:false}
);
}catch{}

}

});

}

});

/* BUTTON HANDLER */

client.on("interactionCreate",async interaction=>{

if(!interaction.isButton()) return;

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

interaction.reply({content:"Delete failed.",ephemeral:true});

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

if(!interaction.isChatInputCommand()) return;

if(interaction.channel.id!==STAFF_CHANNEL)
return interaction.reply({content:"Use commands in staff channel.",ephemeral:true});

/* RISK */

if(interaction.commandName==="risk"){

const user=interaction.options.getUser("member");

const risk=userRisk[user.id]||0;

interaction.reply(`${user.username} risk score: ${risk}`);

}

/* TRUST */

if(interaction.commandName==="trust"){

const user=interaction.options.getUser("member");

const trust=userTrust[user.id]||100;

interaction.reply(`${user.username} trust score: ${trust}`);

}

/* STATS */

if(interaction.commandName==="stats"){

interaction.reply(`Violations detected: ${violationCount}`);

}

/* TIMELINE */

if(interaction.commandName==="timeline"){

const embed=new EmbedBuilder()
.setColor("#ff6ec7")
.setTitle("Server Timeline")
.setDescription(serverTimeline.join("\n")||"No events.");

interaction.reply({embeds:[embed]});

}

/* WATCH */

if(interaction.commandName==="watch"){

const embed=new EmbedBuilder()
.setColor("#ff6ec7")
.setTitle("Server Watch")
.addFields(
{name:"Members",value:`${interaction.guild.memberCount}`,inline:true},
{name:"Channels",value:`${interaction.guild.channels.cache.size}`,inline:true},
{name:"Alerts",value:`${serverTimeline.length}`,inline:true}
);

interaction.reply({embeds:[embed]});

}

/* LOCK */

if(interaction.commandName==="lock"){

interaction.guild.channels.cache.forEach(async channel=>{

if(channel.isTextBased()){

try{
await channel.permissionOverwrites.edit(
interaction.guild.roles.everyone,
{SendMessages:false}
);
}catch{}

}

});

interaction.reply("Server locked.");

}

/* UNLOCK */

if(interaction.commandName==="unlock"){

interaction.guild.channels.cache.forEach(async channel=>{

if(channel.isTextBased()){

try{
await channel.permissionOverwrites.edit(
interaction.guild.roles.everyone,
{SendMessages:true}
);
}catch{}

}

});

interaction.reply("Server unlocked.");

}

/* SLOWMODE */

if(interaction.commandName==="slowmode"){

interaction.channel.setRateLimitPerUser(10);

interaction.reply("Slowmode enabled (10s).");

}

/* AICHECK */

if(interaction.commandName==="aicheck"){
interaction.reply("Cornèr AI monitoring active.");
}

});

client.login(process.env.TOKEN);
