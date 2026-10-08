const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {Pool} = require('pg');
const {PostgresRuleStore, matchesDimensions} = require('../dist/postgres.js');

test('fixed match fields and all wildcard', () => {
  assert.equal(matchesDimensions({customer:['A','B'],facility:'F'}, {customer:'B',facility:'F'}),true);
  assert.equal(matchesDimensions({facility:'F'}, {}),false);
  assert.equal(matchesDimensions({customer:'all',item:'generated-id'}, {facility:'F'}),true);
  assert.equal(matchesDimensions({customer:'all',item:'generated-id'}, {item:'other-id'}),false);
  assert.equal(matchesDimensions({customer:'A',facility:'F',item:'generated-id',cycle:'monthly'}, {item:'generated-id'}),true);
  assert.equal(matchesDimensions({customer_scope:'specific',customer_id:'C1',customer_name:'Acme',facility_scope:'all',cycle:'all'}, {customer_id:'C1'}),true);
  assert.equal(matchesDimensions({customer_scope:'specific',customer_id:'C1',customer_name:'Acme',facility_scope:'all',cycle:'all'}, {customer_id:'C2',customer_name:'Acme'}),false);
  assert.equal(matchesDimensions({customer_scope:'specific',customer_id:'C1',customer_name:'Acme',facility_scope:'all',cycle:'all'}, {customer_name:'Acme'}),true);
});

test('PostgreSQL configuration requires split DB environment variables', () => {
  const names = ['DB_HOST','DB_PORT','DB_USER','DB_NAME','DB_PASSWORD'];
  const previous = Object.fromEntries(names.map(name => [name,process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    assert.throws(()=>new PostgresRuleStore({schema:'agent_ruleset',namespace:'test'}),/DB_HOST, DB_PORT, DB_USER, DB_NAME, DB_PASSWORD/);
    Object.assign(process.env,{DB_HOST:'localhost',DB_PORT:'invalid',DB_USER:'test',DB_NAME:'test',DB_PASSWORD:'test'});
    assert.throws(()=>new PostgresRuleStore({schema:'agent_ruleset',namespace:'test'}),/DB_PORT must be an integer/);
  } finally {
    for (const name of names) previous[name] === undefined ? delete process.env[name] : process.env[name] = previous[name];
  }
});

test('PostgreSQL migrations, CRUD, isolation, concurrency, rollback and references', {skip:!process.env.PI_RULESET_TEST_DATABASE_URL}, async () => {
  // Only run against a disposable database: this test creates the agent_ruleset schema.
  const pool = new Pool({connectionString:process.env.PI_RULESET_TEST_DATABASE_URL});
  const testDatabase = new URL(process.env.PI_RULESET_TEST_DATABASE_URL);
  process.env.DB_HOST = testDatabase.hostname;
  process.env.DB_PORT = testDatabase.port || '5432';
  process.env.DB_USER = decodeURIComponent(testDatabase.username);
  process.env.DB_NAME = decodeURIComponent(testDatabase.pathname.slice(1));
  process.env.DB_PASSWORD = decodeURIComponent(testDatabase.password);
  const config = {schema:'agent_ruleset',namespace:'test-'+Date.now()};
  const store = new PostgresRuleStore(config);
  const other = new PostgresRuleStore({...config,namespace:config.namespace+'-other'});
  try {
    await pool.query('CREATE SCHEMA IF NOT EXISTS agent_ruleset');
    for (let round=0;round<2;round++) for (const migration of ['001_init.sql','002_storage.sql','003_remove_priority.sql','004_fixed_match_fields.sql']) {
      await pool.query(fs.readFileSync(require('node:path').join(__dirname,'../migrations',migration),'utf8'));
    }
    await pool.query(fs.readFileSync(require('node:path').join(__dirname,'../migrations','004_fixed_match_fields.sql'),'utf8'));
    await store.checkSchema();
    assert.equal((await pool.query("SELECT is_generated FROM information_schema.columns WHERE table_schema='agent_ruleset' AND table_name='rules' AND column_name='item_name'")).rows[0].is_generated,'ALWAYS');
    assert.equal((await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='agent_ruleset' AND table_name='rules' AND column_name IN ('priority','rule_id','dimension_name','customer','facility','legacy_item')")).rowCount,0);
    const input = {title:'费用规则',summary:'仓库费用',description:'exact original',raw_description:'原始文字\n- 保留',tags:[],conditions:[],actions:[],customer:'A',facility:'F',cycle:'monthly',references:['policy','policy'],created_by_email:'author@example.com'};
    const added = await store.add(input);
    const read = await store.get(added.id);
    assert.equal(added.item_name,input.title);
    assert.equal(read.item_name,input.title);
    assert.match(read.dimensions.item,/^[0-9a-f-]{36}$/);
    assert.equal(read.dimensions.customer_name,'A');
    assert.equal(read.dimensions.facility_name,'F');
    assert.equal(read.dimensions.customer_scope,'specific');
    assert.equal(read.dimensions.item,added.dimensions.item);
    assert.equal(read.created_by_email,input.created_by_email);
    assert.equal(read.raw_description,input.raw_description);
    assert.deepEqual((await store.list())[0].references,['policy']);
    assert.equal((await store.list(undefined,{customer:'A',facility:'F',cycle:'monthly'})).length,1);
    assert.equal((await store.list(undefined,{item:added.dimensions.item})).length,1);
    assert.equal((await store.list(undefined,{customer:'A',facility:'F',item:'OTHER',cycle:'monthly'})).length,0);
    assert.equal(await other.get(added.id),null);
    const countBeforeFailure = (await store.list()).length;
    await assert.rejects(()=>store.add({...input,customer:''}));
    await assert.rejects(()=>store.add({...input,customer:undefined,customer_scope:'specific'}),/requires an id or name/);
    await assert.rejects(()=>store.add({...input,title:'  '}));
    await assert.rejects(()=>store.add({...input,item_name:'manual'}),/generated/);
    assert.equal((await store.list()).length,countBeforeFailure);
    assert.throws(()=>new PostgresRuleStore({...config,schema:'agent_ruleset; DROP SCHEMA public'}),/Invalid PostgreSQL schema/);
    const concurrent = await Promise.all(Array.from({length:8},()=>store.add({...input,dimensions:{},scope:[]})));
    assert.equal(new Set(concurrent.map(r=>r.id)).size,8);
    assert.equal(new Set(concurrent.map(r=>r.dimensions.item)).size,8);
    await assert.rejects(()=>store.update(added.id,{title:'should roll back',customer:''}));
    await assert.rejects(()=>store.update(added.id,{title:'  '}));
    await assert.rejects(()=>store.update(added.id,{item_name:'manual'}),/generated/);
    assert.equal((await store.get(added.id)).title,input.title);
    await store.update(added.id,{title:'Updated',customer:'B',references:[]},'editor@example.com');
    const updated=await store.get(added.id);
    assert.equal(updated.item_name,'Updated');
    assert.equal((await pool.query('SELECT item_name FROM agent_ruleset.rules WHERE namespace=$1 AND id=$2',[config.namespace,added.id])).rows[0].item_name,'Updated');
    assert.equal(updated.dimensions.customer_name,'B');
    assert.equal(updated.dimensions.facility_name,'F');
    assert.equal(updated.dimensions.item,added.dimensions.item);
    const typed=await store.add({...input,customer:undefined,facility:undefined,customer_id:'C1',customer_name:'Acme',facility_id:'F1',facility_name:'Warehouse'});
    assert.equal(typed.dimensions.customer_id,'C1');
    assert.equal(typed.dimensions.facility_name,'Warehouse');
    assert.equal((await store.list(undefined,{customer_id:'C1',facility_id:'F1',cycle:'monthly'})).some(rule=>rule.id===typed.id),true);
    assert.equal((await store.list(undefined,{customer_id:'C2',customer_name:'Acme',facility_id:'F1',cycle:'monthly'})).some(rule=>rule.id===typed.id),false);
    await assert.rejects(()=>pool.query("UPDATE agent_ruleset.rules SET customer_scope='specific',customer_id=NULL,customer_name=NULL WHERE namespace=$1 AND id=$2",[config.namespace,typed.id]),/rules_customer_identity_chk/);
    await assert.rejects(()=>pool.query("UPDATE agent_ruleset.rules SET facility_scope='specific',facility_id=NULL,facility_name=NULL WHERE namespace=$1 AND id=$2",[config.namespace,typed.id]),/rules_facility_identity_chk/);
    await store.update(typed.id,{customer_scope:'all',facility_scope:'all'});
    const allScoped=await store.get(typed.id);
    assert.equal(allScoped.dimensions.customer_scope,'all');
    assert.equal(allScoped.dimensions.facility_scope,'all');
    assert.equal(allScoped.dimensions.customer_id,undefined);
    await assert.rejects(()=>store.update(typed.id,{facility_scope:'specific'}),/requires an id or name/);
    assert.equal(updated.updated_by_email,'editor@example.com');
    assert.deepEqual(updated.references,[]);
    await store.update(added.id,{dimensions:{},status:'inactive'});
    assert.equal((await store.list('inactive')).length,1);
    assert.equal(await store.remove(added.id),true);
    assert.equal(await store.get(added.id),null);
    assert.equal(await store.remove(added.id),false);
    assert.equal((await pool.query('SELECT archived_at FROM agent_ruleset.rules WHERE namespace=$1 AND id=$2',[config.namespace,added.id])).rows[0].archived_at instanceof Date,true);
    await store.addReference('policy','Policy body');
    assert.equal(await store.getReference('policy'),'Policy body');
    assert.equal(await other.getReference('policy'),null);
    await store.addReference('policy','Updated body');
    assert.equal(await store.getReference('policy'),'Updated body');
  } finally { await store.close(); await other.close(); await pool.end(); }
});
