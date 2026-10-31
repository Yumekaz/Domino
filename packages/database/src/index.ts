import pg from "pg";

export function createPool(connectionString: string) {
  return new pg.Pool({
    connectionString,
    max: 8,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
}
export type Database = pg.Pool;
export {
  replacePendingDependencies,
  findReverseDependencies,
  dependencyObservationSchema,
} from "./dependencies.ts";
export type {
  DependencyObservation,
  StoredDependency,
} from "./dependencies.ts";
export {
  replacePendingStructural,
  readStructuralImports,
} from "./impact.ts";
export type { StructuralImportRecord } from "./impact.ts";
