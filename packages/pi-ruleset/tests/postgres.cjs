const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {Pool} = require('pg');
const {PostgresRuleStore, matchesDimensions} = require('../dist/postgres.js');

test('dimension AND/OR and missing context', () => {
  assert.equal(matchesDimensions({customer:['A','B'],facility:'F'}, {customer:'B',facility:'F'}),true);
  assert.equal(matchesDimensions({facility:'F'}, {}),false);
  assert.equal(matchesDimensions({}, {}),true);
});

test('PostgreSQL migrations, CRUD, isolation, concurrency, rollback and references', {skip:!process.env.PI_RULESET_TEST_DATABASE_URL}, async () => {
  // Only run against a disposable database: this test creates the billing_agent schema.
  const pool = new Pool({connectionString:process.env.PI_RULESET_TEST_DATABASE_URL});
  const config = {connection_string_env:'PI_RULESET_TEST_DATABASE_URL',schema:'billing_agent',namespace:'test-'+Date.now()};
  const store = new PostgresRuleStore(config);
  const other = new PostgresRuleStore({...config,namespace:config.namespace+'-other'});
  try {
    await pool.query('CREATE SCHEMA IF NOT EXISTS billing_agent');
    for (let round=0;round<2;round++) for (const migration of ['001_init.sql','002_storage.sql']) {
      await pool.query(fs.readFileSync(require('node:path').join(__dirname,'../migrations',migration),'utf8'));
    }
    await store.checkSchema();
    const input = {title:'费用规则',summary:'仓库费用',description:'exact original',raw_description:'原始文字\n- 保留',priority:'high',tags:[],conditions:[],actions:[],scope:['A'],dimensions:{facility:['F','G']},references:['policy','policy'],created_by_email:'author@example.com'};
    const added = await store.add(input);
    const read = await store.get(added.id);
    assert.deepEqual({...read.dimensions},{customer:'A',facility:['F','G']});
    assert.equal(read.created_by_email,input.created_by_email);
    assert.equal(read.raw_description,input.raw_description);
    assert.deepEqual((await store.list())[0].references,['policy']);
    assert.equal((await store.list(undefined,{customer:'A',facility:'F'})).length,1);
    assert.equal((await store.list(undefined,{customer:'A'})).length,0);
    assert.equal(await other.get(added.id),null);
    const countBeforeFailure = (await store.list()).length;
    await assert.rejects(()=>store.add({...input,dimensions:{facility:[]}}));
    assert.equal((await store.list()).length,countBeforeFailure);
    assert.throws(()=>new PostgresRuleStore({...config,schema:'billing_agent; DROP SCHEMA public'}),/Invalid PostgreSQL schema/);
    const concurrent = await Promise.all(Array.from({length:8},()=>store.add({...input,dimensions:{},scope:[]})));
    assert.equal(new Set(concurrent.map(r=>r.id)).size,8);
    await assert.rejects(()=>store.update(added.id,{title:'should roll back',dimensions:{'bad name':'x'}}));
    assert.equal((await store.get(added.id)).title,input.title);
    await store.update(added.id,{title:'Updated',scope:['B'],references:[]},'editor@example.com');
    const updated=await store.get(added.id);
    assert.deepEqual({...updated.dimensions},{customer:'B',facility:['F','G']});
    assert.equal(updated.updated_by_email,'editor@example.com');
    assert.deepEqual(updated.references,[]);
    await store.update(added.id,{dimensions:{},status:'inactive'});
    assert.equal((await store.list('inactive')).length,1);
    assert.equal(await store.remove(added.id),true);
    assert.equal(await store.get(added.id),null);
    assert.equal(await store.remove(added.id),false);
    assert.equal((await pool.query('SELECT archived_at FROM billing_agent.rules WHERE namespace=$1 AND id=$2',[config.namespace,added.id])).rows[0].archived_at instanceof Date,true);
    await store.addReference('policy','Policy body');
    assert.equal(await store.getReference('policy'),'Policy body');
    assert.equal(await other.getReference('policy'),null);
    await store.addReference('policy','Updated body');
    assert.equal(await store.getReference('policy'),'Updated body');
  } finally { await store.close(); await other.close(); await pool.end(); }
});
