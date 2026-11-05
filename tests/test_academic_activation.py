import ast,hashlib,json,pathlib,sqlite3,tracemalloc,unittest

source=pathlib.Path(__file__).resolve().parents[1]/'scripts/activate-academic-theme.py'
tree=ast.parse(source.read_text(encoding='utf8'))
function=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='content_state')
scope={'hashlib':hashlib,'json':json}
exec(compile(ast.Module(body=[function],type_ignores=[]),str(source),'exec'),scope)
content_state=scope['content_state']

class AcademicActivationTest(unittest.TestCase):
 def fixture(self):
  db=sqlite3.connect(':memory:')
  db.executescript('CREATE TABLE documents(id TEXT,kind TEXT,permalink TEXT,latest_revision INTEGER,published_revision INTEGER);CREATE TABLE revisions(document_id TEXT,version INTEGER,payload TEXT);CREATE TABLE meta(key TEXT,value TEXT);')
  self.addCleanup(db.close)
  db.execute('INSERT INTO documents VALUES(?,?,?,?,?)',('atomic','history','/history/original/',2,1))
  db.execute('INSERT INTO meta VALUES(?,?)',('calendarMeta','{"说明":"昔日学术"}'))
  return db
 def test_streamed_receipt_matches_existing_format(self):
  db=self.fixture()
  for version,payload in [(1,'{"标题":"引号\\\"与 Unicode 😃"}'),(2,'{"正文":"换行\\n原文"}')]:db.execute('INSERT INTO revisions VALUES(?,?,?)',('atomic',version,payload))
  rows=db.execute('SELECT d.id,d.kind,d.permalink,d.latest_revision,d.published_revision,r.version,r.payload FROM documents d JOIN revisions r ON r.document_id=d.id ORDER BY d.id,r.version').fetchall()
  meta=db.execute("SELECT key,value FROM meta WHERE key IN ('calendarMeta','sourceMeta','initialized') ORDER BY key").fetchall()
  self.assertEqual(content_state(db),{'rows':2,'sha256':hashlib.sha256(json.dumps([rows,meta],ensure_ascii=False).encode()).hexdigest()})
  db.execute('DELETE FROM revisions');self.assertEqual(content_state(db)['sha256'],hashlib.sha256(json.dumps([[],meta],ensure_ascii=False).encode()).hexdigest())
 def test_memory_does_not_accumulate_revision_bodies(self):
  db=self.fixture();payload='x'*200000
  db.executemany('INSERT INTO revisions VALUES(?,?,?)',(('atomic',i,payload)for i in range(40)))
  tracemalloc.start()
  try:
   result=content_state(db);_,peak=tracemalloc.get_traced_memory()
  finally:tracemalloc.stop()
  self.assertEqual(result['rows'],40);self.assertLess(peak,2000000)

if __name__=='__main__':unittest.main()
