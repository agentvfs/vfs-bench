/**
 * The upstream LiveClawBench mocks that run as kit fakes, by service, through
 * upstream/fake.ts, as upstream's image runs each: its entry, app factory
 * and port, the environment the image starts it with
 * (scripts/build-task-images.ts, or the mock's own default where the image
 * sets none), and the SQLite file it keeps its tables in, if any.
 *
 * harbor/fixtures/upstream.ts seeds each the same way, under Bun, for a
 * task's fixture. Plain data, so both read it.
 */
export interface MockSpec {
  /** Upstream's directory for the mock, under mocks/, where it is not the service's name. */
  mock?: string
  /** The entry module, under the mock's directory. */
  entry: string
  factory: string
  port: number
  env: Record<string, string>
  /** Where the mock keeps its SQLite in the image, or `:memory:`. */
  db?: string
}

export const MOCKS: Record<string, MockSpec> = {
  todolist: {
    entry: 'src/index.ts',
    factory: 'createTodolistApp',
    port: 5002,
    env: { TODOLIST_DB_PATH: '/var/lib/mock-data/todolist/todolist.db' },
    db: '/var/lib/mock-data/todolist/todolist.db',
  },
  health: {
    entry: 'src/index.tsx',
    factory: 'createHealthApp',
    port: 5007,
    env: { MOCK_DATA_DIR: '/var/lib/mock-data' },
    db: '/var/lib/mock-data/health/health.db',
  },
  expense: {
    entry: 'src/index.tsx',
    factory: 'createExpenseApp',
    port: 5005,
    env: {
      EXPENSE_MOCK_DB_PATH: '/var/lib/mock-data/expense/expense.db',
      EXPENSE_MOCK_ATTACHMENTS_DIR: '/var/lib/mock-data/expense/attachments',
      EXPENSE_MOCK_DATA_DIR: '/opt/mock/data',
    },
    db: '/var/lib/mock-data/expense/expense.db',
  },
  insurance: {
    entry: 'src/index.tsx',
    factory: 'createInsuranceApp',
    port: 5010,
    env: { INSURANCE_DB_PATH: '/var/lib/mock-data/insurance/insurance.db' },
    db: '/var/lib/mock-data/insurance/insurance.db',
  },
  // A service's name is a word: the kit announces `<SERVICE>_URL`.
  mintdiet: {
    mock: 'mint-diet',
    entry: 'src/index.tsx',
    factory: 'createMintDietApp',
    port: 5003,
    env: { MOCK_DATA_DIR: '/var/lib/mock-data/mint-diet' },
    db: '/var/lib/mock-data/mint-diet/mint-diet.sqlite',
  },
  smarthome: {
    entry: 'src/index.tsx',
    factory: 'createSmarthomeApp',
    port: 5004,
    env: { MOCK_DATA_DIR: '/var/lib/mock-data/smarthome', MOCK_SEED_PATH: '/opt/mock/data/smarthome.sql' },
    db: '/var/lib/mock-data/smarthome/smarthome.db',
  },
  workspace: {
    entry: 'src/index.tsx',
    factory: 'createWorkspaceApp',
    port: 5009,
    env: {},
    db: ':memory:',
  },
  shop: {
    entry: 'src/index.tsx',
    factory: 'createShopApp',
    port: 1234,
    env: { MOCK_DATA_DIR: '/var/lib/mock-data/shop', MOCK_PRODUCTS_PATH: '/opt/mock/static/shop/products.json' },
  },
}
