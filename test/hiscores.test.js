import test from 'node:test';
import assert from 'node:assert/strict';
import {categories, boardMessage, boardOverwrites, validateScores, setupBoards, refreshBoards, gameJson} from '../src/hiscores.js';
import {handleInteraction} from '../src/bot.js';
const player = (account, value, discord_id = null) => ({account, name:`Guest${account}`, discord_id, base_fame:value, collection:value, total_fame:value});
const scores = {updated_at:1,players:[player(3,10),player(2,10,'1558662335076376578'),player(1,20)]};

test('top ten has competition ties, stable account ordering, website link, no buttons or pings', () => {
  const message = boardMessage(scores.players,categories[0],'https://openrotmg.org/');
  assert.deepEqual(message.allowed_mentions,{parse:[]});assert.equal(message.components,undefined);
  assert.match(message.embeds[0].description,/\*\*1\.\*\* Guest1/);
  assert.match(message.embeds[0].description,/\*\*2\.\*\* Guest2.*<@1558662335076376578>/);
  assert.match(message.embeds[0].description,/\*\*2\.\*\* Guest3/);
  assert.match(message.embeds[0].description,/https:\/\/openrotmg.org\/hiscores\/\?board=base_fame/);
  assert.equal((boardMessage(Array.from({length:20},(_,i)=>player(i+1,i)),categories[0],'https://openrotmg.org/').embeds[0].description.match(/ - \*\*/g)??[]).length,10);
});
test('invalid values and duplicate players fail before edits', () => {
  assert.equal(validateScores(scores),scores);
  for (const bad of [null,{...scores,players:[player(1,-1)]},{...scores,players:[player(1,1),player(1,2)]},{...scores,players:[{...player(1,1),name:'@everyone'}]},{...scores,players:[player(1,NaN)]}]) assert.throws(()=>validateScores(bad));
});
test('edits permanent messages only when content changes, retries failed edits',async()=>{
  const calls=[],boards=categories.map((category,i)=>({category,channelId:`c${i}`,messageId:`m${i}`,previous:null}));
  const rest={patch:async(route,payload)=>calls.push({route,payload})};
  await refreshBoards(rest,boards,scores,'https://openrotmg.org/');assert.equal(calls.length,3);
  await refreshBoards(rest,boards,{...scores,updated_at:999},'https://openrotmg.org/');assert.equal(calls.length,3);
  await refreshBoards(rest,boards,{...scores,players:scores.players.map(p=>({...p,collection:p.collection+1}))},'https://openrotmg.org/');assert.equal(calls.length,4);assert.equal(calls[3].route,'/channels/c1/messages/m1');
  const before=boards[0].previous;
  await assert.rejects(refreshBoards({patch:async()=>{throw Error('denied');}},boards,{...scores,players:[]},'https://openrotmg.org/'),/denied/);assert.equal(boards[0].previous,before);
});
test('setup adopts only exact bot-marked messages; missing/duplicate channels fail closed',async()=>{
  const channels=[{id:'1559701388928483419',name:'Hiscores',type:4},...categories.map((c,i)=>({id:`c${i}`,name:c.name,type:0,parent_id:'1559701388928483419'}))];
  const config={guildId:'guild',categoryId:'1559701388928483419',botId:'bot',site:'https://openrotmg.org/'};
  const rest={get:async route=>route.includes('/guilds/')?channels:[{id:'foreign',author:{id:'other'},embeds:[{footer:{text:'Open RotMG hiscores'}}]},{id:'own',author:{id:'bot'},embeds:[{footer:{text:'Open RotMG hiscores'}}]}]};
  const boards=await setupBoards(rest,config);assert.equal(boards.length,3);assert.equal(boards[0].messageId,'own');
  await assert.rejects(setupBoards({get:async()=>channels.slice(0,1)},config),/Missing #fame/);
  await assert.rejects(setupBoards({get:async()=>[...channels,channels[1]]},config),/Duplicate/);
});
test('read-only boards preserve category visibility instead of widening private access', () => {
  const rules = boardOverwrites({permission_overwrites:[{id:'guild',type:0,allow:'2048',deny:'1024'},{id:'private-role',type:0,allow:'1024',deny:'0'}]},'guild','bot');
  const everyone = rules.find(o=>o.id==='guild'), role=rules.find(o=>o.id==='private-role'), bot=rules.find(o=>o.id==='bot');
  assert.equal(BigInt(everyone.deny)&1024n,1024n);assert.equal(BigInt(everyone.allow)&2048n,0n);
  assert.equal(BigInt(role.allow)&1024n,1024n);assert.equal(BigInt(role.deny)&2048n,2048n);
  assert.equal(BigInt(bot.allow)&3072n,3072n);assert.equal(BigInt(bot.deny)&3072n,0n);
});
test('private API never follows redirects, has deadline, no credentials for public scores',async()=>{
  const calls=[];const fetchImpl=async(url,opts)=>{calls.push(opts);return {ok:true,json:async()=>({name:'Owner'})};};
  await gameJson('http://127.0.0.1:19087/api/hiscores',{fetchImpl});assert.deepEqual(calls[0].headers,{});assert.equal(calls[0].redirect,'error');
  await gameJson('http://127.0.0.1:19087/internal/discord/link',{fetchImpl,token:'private',body:{code:'secret',discord_id:'id'}});
  assert.equal(calls[1].headers.authorization,'Bearer private');assert.ok(calls[1].signal);assert.equal(calls[1].method,'POST');
  await assert.rejects(gameJson('http://localhost',{fetchImpl:async()=>({ok:false,status:400,json:async()=>({error:'invalid or expired link code'})})}),/expired/);
});
test('/link is ephemeral, redeems the invoking Discord identity, instructions contain no password request',async()=>{
  const calls=[];let redeemed;
  const interaction={guildId:'guild',user:{id:'1558662335076376578'},commandName:'link',isChatInputCommand:()=>true,options:{getString:()=> 'a'.repeat(32)},deferReply:async p=>calls.push(p),editReply:async p=>calls.push(p)};
  await handleInteraction(interaction,{guildId:'guild',linkGame:async(code,id)=>{redeemed={code,id};return {name:'Owner'};}});
  assert.equal(calls[0].flags,64);assert.equal(redeemed.id,interaction.user.id);assert.match(calls[1].content,/Linked to \*\*Owner/);
  interaction.options.getString=()=>null;interaction.reply=async p=>calls.push(p);
  await handleInteraction(interaction,{guildId:'guild',linkGame:async()=>assert.fail('must not call API')});assert.equal(calls.at(-1).flags,64);assert.match(calls.at(-1).content,/Never send a password/);
});
