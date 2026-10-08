const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const extension = require('../dist/index.js').default;

function harness(storage) {
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'ruleset-tools-'));
  fs.mkdirSync(path.join(cwd,'.pi'));
  fs.writeFileSync(path.join(cwd,'.pi/settings.json'),JSON.stringify({'pi-ruleset':{storage,mode:'project-only',postgres:{schema:'agent_ruleset',namespace:path.basename(cwd)}}}));
  const tools={},events={};
  extension({registerTool:tool=>tools[tool.name]=tool,on:(name,fn)=>events[name]=fn});
  const ctx={cwd,ui:{notify(){}}};
  return {cwd,events,ctx,call:(name,args)=>tools[name].execute('test',args,undefined,undefined,ctx),async close(){await events.session_shutdown();fs.rmSync(cwd,{recursive:true,force:true});}};
}
const input={title:'仓库计费',summary:'仓库费用规则',description:'说明',conditions:[],actions:[],priority:'high',tags:[],references:[],customer:'A',facility:'F',cycle:'monthly',force:true};

test('Markdown add/list/read/update/archive regression with empty scope/tags',async()=>{
  const h=harness('markdown');
  try {
    await h.call('ruleset_add',input);
    assert.match((await h.call('ruleset_list',{})).content[0].text,/仓库计费/);
    assert.match((await h.call('ruleset_get',{query:'仓库'})).content[0].text,/仓库计费/);
    await h.call('ruleset_update',{id:'001',title:'Updated'});
    assert.match((await h.call('ruleset_get',{id:'001'})).content[0].text,/Updated/);
    await h.call('ruleset_remove',{id:'001'});
    assert.equal((await h.call('ruleset_get',{id:'001'})).isError,true);
  } finally {await h.close();}
});

test('PostgreSQL tools and async context use database only', {skip:!process.env.PI_RULESET_TEST_DATABASE_URL}, async()=>{
  const testDatabase=new URL(process.env.PI_RULESET_TEST_DATABASE_URL);
  process.env.DB_HOST=testDatabase.hostname;
  process.env.DB_PORT=testDatabase.port || '5432';
  process.env.DB_USER=decodeURIComponent(testDatabase.username);
  process.env.DB_NAME=decodeURIComponent(testDatabase.pathname.slice(1));
  process.env.DB_PASSWORD=decodeURIComponent(testDatabase.password);
  const h=harness('postgres');
  try {
    await h.events.session_start({},h.ctx);
    await h.call('ruleset_add',{...input,customer:'A',facility:'F',cycle:'monthly'});
    await h.call('ruleset_add',{...input,title:'专属规则',customer:undefined,facility:undefined,customer_id:'C1',customer_name:'客户一',facility_id:'F1',facility_name:'仓库一'});
    assert.match((await h.call('ruleset_get',{id:'002'})).content[0].text,/customer_id/);
    assert.match((await h.call('ruleset_list',{customer_id:'C1',facility_id:'F1',cycle:'monthly'})).content[0].text,/专属规则/);
    assert.match((await h.call('ruleset_list',{customer_id:'C1',facility_id:'F1',cycle:'monthly'})).content[0].text,/customer: id=C1, name=客户一/);
    await assert.rejects(()=>h.call('ruleset_add',{...input,item_name:'manual'}),/generated/);
    await assert.rejects(()=>h.call('ruleset_add',{...input,dimensions:{item:'manual'}}),/generated/);
    assert.match((await h.call('ruleset_get',{id:'001'})).content[0].text,/facility/);
    assert.match((await h.call('ruleset_get',{id:'001'})).content[0].text,/Item name:.*仓库计费/);
    assert.match((await h.call('ruleset_get',{query:'仓库',customer:'A',facility:'F',cycle:'monthly'})).content[0].text,/仓库计费/);
    assert.equal((await h.call('ruleset_list',{facility:'OTHER'})).content[0].text,'No rules found.');
    const context=await h.events.context({messages:[]},h.ctx);
    assert.match(context.messages[0].content,/facility/);
    await h.call('ruleset_update',{id:'001',title:'Changed',facility:'G'});
    await assert.rejects(()=>h.call('ruleset_update',{id:'001',item_name:'manual'}),/generated/);
    assert.match((await h.call('ruleset_list',{})).content[0].text,/Changed/);
    await h.call('ruleset_add_reference',{name:'p',content:'body'});
    assert.equal((await h.call('ruleset_get_reference',{name:'p'})).content[0].text,'body');
    await h.call('ruleset_remove',{id:'001'});
    assert.equal((await h.call('ruleset_get',{id:'001'})).isError,true);
    await h.call('ruleset_restore',{id:'001'});
    assert.match((await h.call('ruleset_get',{id:'001'})).content[0].text,/Changed/);
    await assert.rejects(()=>h.call('ruleset_add',{...input,target:'global'}));
    assert.equal(fs.existsSync(path.join(h.cwd,'.pi/rules')),false);
  } finally {await h.close();}
});
