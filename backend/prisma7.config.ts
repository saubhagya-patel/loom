import { defineConfig } from 'prisma/config'

// Node 25 has a built-in loader, so Prisma's suggested `dotenv/config` import is
// unnecessary. It throws when .env is absent, which is fine — CI supplies the env
// directly, matching --env-file-if-exists semantics.
try {
  process.loadEnvFile()
} catch {
  // no .env; rely on the ambient environment
}

// No `migrations` block: the schema is hand-written SQL in db/ (docs/plan.md §2.1).
// url is spread conditionally because exactOptionalPropertyTypes rejects `string | undefined`.
const url = process.env['DATABASE_URL']

export default defineConfig({
  schema: 'prisma/schema.prisma',
  ...(url ? { datasource: { url } } : {}),
})
