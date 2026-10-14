import {readFileSync} from 'node:fs';
import {REST, Routes} from 'discord.js';
import {setupBoards} from '../src/hiscores.js';
const rest = new REST({version:'10',retries:0}).setToken(readFileSync(process.env.DISCORD_BOT_TOKEN_FILE,'utf8').trim());
const bot = await rest.get(Routes.user());
if (bot.id !== process.env.DISCORD_APPLICATION_ID) throw new Error('Unexpected bot account');
const boards = await setupBoards(rest,{guildId:process.env.DISCORD_GUILD_ID,categoryId:process.env.HISCORES_CATEGORY_ID,botId:bot.id,site:'https://openrotmg.org/',create:true});
console.log(JSON.stringify({event:'hiscores_setup',boards:boards.map(b=>({name:b.category.name,channelId:b.channelId,messageId:b.messageId}))}));
