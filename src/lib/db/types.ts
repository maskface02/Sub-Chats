import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { schema } from "./schema";

// Canonical db type for both driver branches (US-510): the pglite instance is
// cast to this at construction so consumers see one type regardless of branch.
export type Db = NodePgDatabase<typeof schema>;
