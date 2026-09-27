-- Loom — complete current schema. Runnable against an empty database:
--
--   npm run db:up
--   docker compose exec -T mysql mysql -uloom -ploom loom < backend/db/schema.sql
--
-- This file is the source of truth and is applied by hand. `prisma/schema.prisma` is
-- generated from the live database by `npm run prisma:pull` and is never hand-edited
-- (docs/plan.md §2.1). There is no `prisma migrate`, and nothing tracks which scripts have
-- been applied — incremental changes go in db/changes/NNN-*.sql and also land here.

-- Loom's only table, and it holds identity alone. Everything about a file — name, size,
-- folder tree, upload history — lives in Drive and is deliberately absent (docs/plan.md
-- §4.2): the database cannot leak what it never held. A future column describing a file is
-- a change to the architecture, not a schema tweak.
CREATE TABLE `users` (
  -- Google's profile `sub`, not an autoincrement. We mint no id of our own, so there is
  -- none of ours to leak or correlate across systems (docs/plan.md §4.1).
  `id` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  -- AES-256-GCM ciphertext, formatted `v1:<iv>:<tag>:<ct>` — never a plaintext token.
  -- Written and read only through src/auth/token-crypto.ts. This is docs/plan.md §2.2
  -- deliberately overriding TRD §4, which stores the token in the clear: a refresh token
  -- for drive.file is a durable key to every file this app has touched, and a plaintext
  -- column makes one database dump permanent, silent access to all of it.
  `refresh_token` TEXT NOT NULL,
  -- NULL until the first exchange creates the Drive folder and records its id.
  `app_folder_id` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  -- Google's `sub` and email are 1:1 for a consumer account, so email is a safe natural key
  -- and the unique constraint catches a second row for the same person.
  UNIQUE KEY `users_email_key` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
