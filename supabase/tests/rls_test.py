"""
Row Level Security attack tests for supabase/setup.sql (61 checks).

Creates two farmers (A and B) and verifies that B — using only what the public
API key allows — cannot read, change, forge or delete A's data, that the
community/heatmap sharing works as designed, and that logged-out visitors get nothing.

Run against a throwaway local PostgreSQL (never your real Supabase project):
    createdb agri_test
    psql -d agri_test -f supabase/tests/supabase_stub.sql
    psql -d agri_test -f supabase/setup.sql
    PGDATABASE=agri_test python3 supabase/tests/rls_test.py
Connection uses the standard PGHOST / PGPORT / PGUSER / PGDATABASE environment variables.
"""
import os, subprocess, sys
A='aaaaaaaa-0000-0000-0000-000000000001'; B='bbbbbbbb-0000-0000-0000-000000000002'
def run(sql, role=None, sub=None):
    pre = ''
    if role: pre += f"set role {role};"
    if sub: pre += f"set request.jwt.claim.sub = '{sub}';"
    p = subprocess.run(['psql','-d',os.environ.get('PGDATABASE','agri_test'),'-tAq','-v','ON_ERROR_STOP=1','-c', pre + sql], capture_output=True, text=True)
    return p.returncode, (p.stdout.strip().splitlines() or [''])[-1], p.stderr.strip()
results=[]
def expect_value(name, sql, want, **kw):
    rc,out,err = run(sql, **kw)
    ok = rc==0 and out==str(want)
    results.append(('PASS' if ok else 'FAIL', name, '' if ok else f'got rc={rc} out={out!r} err={err[:160]}'))
def expect_blocked(name, sql, **kw):
    rc,out,err = run(sql, **kw)
    ok = rc!=0 and ('row-level security' in err or 'permission denied' in err or 'violates check constraint' in err)
    results.append(('PASS' if ok else 'FAIL', name, '' if ok else f'rc={rc} out={out!r} err={err[:160]}'))
def ok(name, sql, **kw):
    rc,out,err = run(sql, **kw)
    results.append(('PASS' if rc==0 else 'FAIL', name, err[:200]))
    return out

# ── setup: two sign-ups (trigger must create profiles)
ok('signup creates profiles', f"insert into auth.users(id,email,raw_user_meta_data) values ('{A}','a@x','{{\"full_name\":\"Ravi Kumar\"}}'),('{B}','b@x','{{\"full_name\":\"Sita Devi\"}}')")
expect_value('profile rows exist for both users', "select count(*) from public.users", 2)

asA=dict(role='authenticated', sub=A); asB=dict(role='authenticated', sub=B)
# ── A creates data through the same paths the app uses
farm=ok('A creates farm', "insert into farms(user_id,name,lat,lng) values (auth.uid(),'A farm',17.385044,78.486671) returning id", **asA)
crop=ok('A creates crop cycle', f"insert into crop_cycles(farm_id,crop_name) values ('{farm}','Rice') returning id", **asA)
task=ok('A creates AI task', f"insert into crop_tasks(crop_cycle_id,task_name,category,priority,ai_generated) values ('{crop}','Irrigate','irrigation','high',true) returning id", **asA)
ok('A marks task done', f"update crop_tasks set status='done', completed_at=now() where id='{task}'", **asA)
diag=ok('A saves diagnosis', "insert into diagnoses(user_id,crop_type,image_urls,disease_name,severity,confidence_pct) values (auth.uid(),'Rice','{\"" + A + "/1.jpg\"}','Blast','high',87) returning id", **asA)
sess=ok('A creates chat session', "insert into chat_sessions(user_id) values (auth.uid()) returning id", **asA)
ok('A writes chat message', f"insert into chat_messages(session_id,role,content) values ('{sess}','user','hello')", **asA)
ok('A gets field alert notification', "insert into notifications(user_id,type,title,message,metadata) values (auth.uid(),'alert_critical','Heat','Very hot','{\"farm_id\":\"x\"}')", **asA)
post=ok('A creates community post', "insert into community_posts(user_id,title,body) values (auth.uid(),'Leaf spots?','Help') returning id", **asA)
ok('A updates own profile', "update users set phone='9999' where id=auth.uid()", **asA)
expect_value('author_name stamped from profile', f"select author_name from community_posts where id='{post}'", 'Ravi Kumar', **asA)
expect_value('A cannot spoof author_name (client sends "CEO", DB stores real name)', "insert into community_posts(user_id,title,body,author_name) values (auth.uid(),'t','b','CEO'); select author_name from community_posts where title='t'", 'Ravi Kumar', **asA)

# ── B tries to read A's private data → must see NOTHING
for t in ['farms','crop_cycles','crop_tasks','diagnoses','chat_sessions','chat_messages','notifications']:
    expect_value(f'B cannot read A\'s {t}', f"select count(*) from {t}", 0, **asB)
expect_value("B cannot read A's profile (phone etc.)", f"select count(*) from users where id='{A}'", 0, **asB)
expect_value('B sees only own profile', "select count(*) from users", 1, **asB)

# ── B tries to modify / delete A's data → 0 rows affected
expect_value("B cannot update A's farm", f"with u as (update farms set name='hacked' where id='{farm}' returning 1) select count(*) from u", 0, **asB)
expect_value("B cannot delete A's diagnosis", f"with d as (delete from diagnoses where id='{diag}' returning 1) select count(*) from d", 0, **asB)
expect_value("B cannot delete A's post", f"with d as (delete from community_posts where id='{post}' returning 1) select count(*) from d", 0, **asB)
expect_value("B cannot edit post upvotes (no update policy)", f"with u as (update community_posts set upvotes=999 where id='{post}' returning 1) select count(*) from u", 0, **asB)
expect_value("A cannot inflate own post upvotes either", f"with u as (update community_posts set upvotes=999 where id='{post}' returning 1) select count(*) from u", 0, **asA)

# ── B tries to write INTO A's account → blocked
expect_blocked("B cannot create farm as A", f"insert into farms(user_id,name) values ('{A}','x')", **asB)
expect_blocked("B cannot add crop to A's farm", f"insert into crop_cycles(farm_id,crop_name) values ('{farm}','x')", **asB)
expect_blocked("B cannot add task to A's crop", f"insert into crop_tasks(crop_cycle_id,task_name) values ('{crop}','x')", **asB)
expect_blocked("B cannot inject messages into A's chat", f"insert into chat_messages(session_id,role,content) values ('{sess}','assistant','phish')", **asB)
expect_blocked("B cannot send A a notification", f"insert into notifications(user_id,title) values ('{A}','x')", **asB)
expect_blocked("B cannot post as A", f"insert into community_posts(user_id,title,body) values ('{A}','x','y')", **asB)
expect_blocked("B cannot forge an AI reply", f"insert into community_replies(post_id,user_id,is_ai,content) values ('{post}',null,true,'fake AI advice')", **asB)
expect_blocked("B cannot reply as A", f"insert into community_replies(post_id,user_id,content) values ('{post}','{A}','x')", **asB)
expect_blocked("B cannot move own farm to A (update user_id)", "insert into farms(user_id,name) values (auth.uid(),'B farm'); update farms set user_id='" + A + "' where name='B farm'", **asB)

# ── Community is shared
expect_value('B can read community posts', "select count(*) from community_posts", 2, **asB)
ok('B can reply as self', f"insert into community_replies(post_id,user_id,content) values ('{post}',auth.uid(),'Try neem oil')", **asB)
expect_value('reply author_name stamped', "select author_name from community_replies", 'Sita Devi', **asB)
ok('server (service role) can add AI reply', f"insert into community_replies(post_id,user_id,is_ai,content) values ('{post}',null,true,'AI says')", role='service_role')
expect_value('AI reply labelled', "select author_name from community_replies where is_ai", 'AgriDoctor AI', **asA)

# ── Heatmap: cross-farmer but anonymised
expect_value('heatmap shows A\'s outbreak to B', "select count(*) from disease_heatmap(90,null)", 1, **asB)
expect_value('heatmap location rounded (~1 km)', "select lat||','||lng from disease_heatmap(90,null)", '17.39,78.49', **asB)
expect_value('heatmap is_mine false for B', "select is_mine from disease_heatmap(90,null)", 'f', **asB)
expect_value('heatmap is_mine true for A', "select is_mine from disease_heatmap(90,null)", 't', **asA)
expect_value('heatmap crop filter', "select count(*) from disease_heatmap(90,'wheat')", 0, **asB)
expect_value('heatmap has no user_id column', "select count(*) from information_schema.columns c join information_schema.routines r on false", 0)

# ── Logged-out visitor (anon key only) gets nothing
for t in ['users','farms','diagnoses','community_posts','notifications']:
    expect_blocked(f'anon cannot read {t}', f"select count(*) from {t}", role='anon')
expect_blocked('anon cannot call heatmap', "select * from disease_heatmap(90,null)", role='anon')

# ── Storage: own folder only
ok('A uploads to own folder', f"insert into storage.objects(bucket_id,name) values ('diagnosis-images','{A}/1.jpg')", **asA)
expect_blocked("B cannot upload into A's folder", f"insert into storage.objects(bucket_id,name) values ('diagnosis-images','{A}/evil.jpg')", **asB)
expect_value("B cannot see A's photos", "select count(*) from storage.objects", 0, **asB)
expect_value('A sees own photos', "select count(*) from storage.objects", 1, **asA)
expect_value('bucket is private', "select public from storage.buckets where id='diagnosis-images'", 'f')

# ── Cascades: deleting a farm removes its crops & tasks
ok('A deletes farm', f"delete from farms where id='{farm}'", **asA)
expect_value('crops/tasks cascade-deleted', "select (select count(*) from crop_cycles)+(select count(*) from crop_tasks)", 0, role='service_role')

for s,n,d in results: print(f"{s}  {n}" + (f"  → {d}" if d and s=='FAIL' else ''))
print(f"\n{sum(r[0]=='PASS' for r in results)}/{len(results)} passed")
sys.exit(0 if all(r[0]=='PASS' for r in results) else 1)
