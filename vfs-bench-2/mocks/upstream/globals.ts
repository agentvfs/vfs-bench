/**
 * The globals an upstream mock reads from its process, each its run's
 * (instance.ts), which bundle.ts injects into the mock's copy in place of
 * the process's own.
 */
export { Bun, Date, __vfsbenchEnv } from './instance.ts'
