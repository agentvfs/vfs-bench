import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dataSpaceWorkspace, verifyDataSpace, type DataSpaceRequest } from './verify-dataspace.ts'
import { quote } from './graders/context.ts'
const PYTHON = process.env.VFSBENCH_TEST_PYTHON ?? 'python3'
const config = (columns: unknown[], ordered = false) => ({
  schema_version: '1.0',
  task_id: 'task_33',
  order_sensitive: ordered,
  columns: columns.map((c: any, i) => ({ gold_index: i, gold_name: 'v' + i, ...c })),
})
function request(
  prediction: string | undefined,
  gold = 'v\na\n',
  cfg = config([{ type: 'text' }])
): DataSpaceRequest {
  const bytes: Record<string, string> = {
    '/opt/dataspace-evaluation/configs/task_33.json': JSON.stringify(cfg),
    '/opt/dataspace-evaluation/gold/gold.csv': gold,
    '/.verifier-input/status.json': JSON.stringify({
      task_id: 'task_33',
      kind: prediction === undefined ? 'missing' : 'file',
      size: Buffer.byteLength(prediction ?? ''),
    }),
  }
  if (prediction !== undefined) bytes['/output/prediction.csv'] = prediction
  return {
    task: 'fund-ytd-returns',
    timeoutSeconds: 20,
    files: Object.fromEntries(Object.entries(bytes).map(([k, v]) => [k, Buffer.from(v).toString('base64')])),
  }
}

test('DataSpace compares multisets, order, multiplicity and column permutations', async () => {
  const columns = [{ type: 'text' }, { type: 'number', comparison: { mode: 'integer' } }]
  const gold = 'name,count\na,1\nb,2\na,1\n',
    prediction = 'renamed,headers\n2,b\n1,a\n1,a\n'
  const good = await verifyDataSpace(request(prediction, gold, config(columns)))
  assert.equal(good.score, 1)
  assert.deepEqual(good.artifacts['evaluation.json'].column_mapping, [
    { gold_index: 0, prediction_index: 1 },
    { gold_index: 1, prediction_index: 0 },
  ])
  const ordered = await verifyDataSpace(request(prediction, gold, config(columns, true)))
  assert.equal(ordered.score, 0)
  assert.equal(ordered.artifacts['evaluation.json'].error_code, 'relation_mismatch')
  const duplicate = await verifyDataSpace(request('name,count\na,1\nb,2\nb,2\n', gold, config(columns)))
  assert.equal(duplicate.score, 0)
})

test('DataSpace keeps Unicode normalization, decimal precision and invalid-output errors', async () => {
  const cols = [{ type: 'text' }, { type: 'number', comparison: { mode: 'decimal_places', digits: 4 } }]
  const good = await verifyDataSpace(
    request('\ufeffother,header\r\n" e\u0301 ",1.23445\r\n', 'a,b\né,1.2345\n', config(cols))
  )
  assert.equal(good.score, 1)
  for (const [prediction, code] of [
    [undefined, 'missing_prediction'],
    ['', 'invalid_prediction_csv'],
    ['a\n"broken', 'invalid_prediction_csv'],
    ['a\n\x00', 'invalid_prediction_csv'],
    ['a\nb\nc\n', 'row_count_mismatch'],
  ] as const) {
    const out = await verifyDataSpace(request(prediction))
    assert.equal(out.score, 0)
    assert.equal(out.artifacts['evaluation.json'].error_code, code)
  }
})

test('DataSpace gold/config/prediction mounts are read-only and concurrent workspaces are separate', async () => {
  const ws = await dataSpaceWorkspace(request('v\na\n'))
  try {
    const result = await ws.shell(
      'python -c ' +
        quote(`from pathlib import Path
for name in ['/output/prediction.csv', '/opt/dataspace-evaluation/gold/gold.csv', '/opt/dataspace-evaluation/configs/task_33.json']:
    try:
        Path(name).write_text('forged')
        raise AssertionError('writable input')
    except OSError as error:
        assert 'Read-only file system' in str(error)
assert not Path('/etc/passwd').exists()
print('confined')`)
    )
    assert.equal(result.exitCode, 0, result.stderrText)
    assert.equal(result.stdoutText.trim(), 'confined')
  } finally {
    await ws.close()
  }
  const [a, b] = await Promise.all([verifyDataSpace(request('v\na\n')), verifyDataSpace(request('v\nb\n'))])
  assert.equal(a.score, 1)
  assert.equal(b.score, 0)
})

test('strict CSV adapter matches CPython on 2000 deterministic malformed and quoted records', async () => {
  let seed = 19
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0)
  const alphabet = Array.from('abé😀\r\n,"\x00 ')
  const cases = Array.from({ length: 2000 }, () =>
    Array.from({ length: random() % 50 }, () => alphabet[random() % alphabet.length]).join('')
  )
  cases.push('', 'a,', '"a" ', '"a"\r\nb', 'a\r\r\nb', '"a\r\nb",c\n', '\n\n', ',\n', '""""')
  const reference = spawnSync(
    PYTHON,
    [
      '-I',
      '-c',
      `import csv,io,json,sys
out=[]
for text in json.load(sys.stdin):
    try:
        rows=[]
        for n,row in enumerate(csv.reader(io.StringIO(text,newline=''),strict=True),1):
            if any('\\x00' in c for c in row): raise ValueError(f'NUL byte in CSV cell at row {n}: /output/prediction.csv')
            rows.append(row)
        out.append({'rows':rows})
    except (ValueError,csv.Error) as e: out.append({'error':str(e)})
print(json.dumps(out))`,
    ],
    { input: JSON.stringify(cases), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
  )
  assert.equal(reference.status, 0, reference.stderr)
  const ws = await dataSpaceWorkspace(request(JSON.stringify(cases)))
  try {
    const code =
      `import json\nfrom pathlib import Path\nMAX_CSV_ROWS=100000\nMAX_CELL_CHARACTERS=2097152\n` +
      readFileSync(new URL('./graders/dataspace/csv_compat.py', import.meta.url), 'utf8') +
      `
out=[]
for text in json.loads(Path('/output/prediction.csv').read_text()):
    try:
        out.append({'rows':csv_records(text,'/output/prediction.csv',ValueError)})
    except (ValueError,SyntaxError) as error:
        out.append({'error':str(error)})
print(json.dumps(out))`
    const result = await ws.shell('python -c ' + quote(code))
    assert.equal(result.exitCode, 0, result.stderrText)
    assert.deepEqual(JSON.parse(result.stdoutText), JSON.parse(reference.stdout))
  } finally {
    await ws.close()
  }
})

test('DataSpace generated port stays pinned and unknown tasks/timeouts fail without rewards', async () => {
  const check = spawnSync(
    PYTHON,
    ['-I', new URL('./dataspace_manifest.py', import.meta.url).pathname, '--check-port'],
    { encoding: 'utf8' }
  )
  assert.equal(check.status, 0, check.stderr)
  await assert.rejects(verifyDataSpace({ ...request('v\na\n'), task: '../unregistered' }), /Unregistered/)
  await assert.rejects(
    verifyDataSpace({ ...request('v\na\n'), timeoutSeconds: 0.001 }),
    /failed|time limit|timeout/i
  )
})

test('date normalization matches the CPython 3.12 reference for basic/week dates, offsets and invalid forms', async () => {
  const referencePython = process.env.VFSBENCH_REFERENCE_PYTHON ?? 'python3.12'
  const dates = [
    '2020-01-01',
    '20200101',
    '2020-W01',
    '2020W01',
    '2020-W01-3',
    '2020W013',
    '2020-W53-7',
    '2021-W53-1',
    '0001-01-01',
    '9999-12-31',
    '2020-02-30',
    '2020-W01-12',
    '2020W01120000',
    '9999-W52-7',
    '0000-W01-1',
  ]
  const times = [
    '',
    'T00',
    'T0000',
    'T000000',
    'T00:00:00',
    'T12.5',
    'T12:30.5',
    'T12:30:59.1234567',
    'T24:00',
    'T12:3000',
    '😀12:34:56',
    '1000000',
    'T12345678',
    'T1234567',
    'T12:34:56:78',
    'T12x',
  ]
  const zones = ['', 'Z', '+0000', '+02:00', '-01:00:01.5', '+00:00:00.5', '+00:99', '+24:00']
  const cases = [
    ...dates,
    ...dates.flatMap((d) => times.slice(1).flatMap((t) => zones.map((z) => d + t + z))),
    'null',
    '\u0085nat\u001c',
    '2020-01-01T00:00:00,123456',
    '２０２０-01-01',
  ]
  const script = `import importlib.util,json,sys
assert sys.version_info[:2]==(3,12), 'Use VFSBENCH_REFERENCE_PYTHON with CPython 3.12'
spec=importlib.util.spec_from_file_location('ref',${JSON.stringify(
    new URL('./graders/dataspace/reference/evaluate.py', import.meta.url).pathname
  )})
m=importlib.util.module_from_spec(spec);sys.modules['ref']=m;spec.loader.exec_module(m)
out=[]
for text in json.load(sys.stdin):
    row=[]
    for fn in [m.normalize_date,m.normalize_datetime]:
        try: row.append({'ok':fn(text)})
        except m.CellNormalizationError: row.append({'invalid':True})
        except Exception as e: row.append({'fatal':type(e).__name__})
    out.append(row)
print(json.dumps(out))`
  const ref = spawnSync(referencePython, ['-I', '-c', script], {
    input: JSON.stringify(cases),
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  })
  assert.equal(ref.status, 0, ref.error?.message ?? ref.stderr)
  const ws = await dataSpaceWorkspace(request(JSON.stringify(cases)))
  try {
    const code =
      readFileSync(new URL('./graders/dataspace/port.py', import.meta.url), 'utf8') +
      '\n' +
      readFileSync(new URL('./graders/dataspace/datetime_compat.py', import.meta.url), 'utf8') +
      `
out=[]
for text in json.loads(Path('/output/prediction.csv').read_text()):
    row=[]
    for fn in [normalize_date,normalize_datetime]:
        try:
            row.append({'ok':fn(text)})
        except CellNormalizationError:
            row.append({'invalid':True})
        except Exception as error:
            row.append({'fatal':type(error).__name__})
    out.append(row)
print(json.dumps(out))`
    const result = await ws.shell('python -c ' + quote(code))
    assert.equal(result.exitCode, 0, result.stderrText)
    const actual = JSON.parse(result.stdoutText),
      expected = JSON.parse(ref.stdout)
    for (let i = 0; i < cases.length; i++) assert.deepEqual(actual[i], expected[i], cases[i])
  } finally {
    await ws.close()
  }
})
