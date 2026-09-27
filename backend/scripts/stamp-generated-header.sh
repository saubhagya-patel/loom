#!/usr/bin/env bash
# `prisma db pull` rewrites prisma/schema.prisma wholesale and strips any comment above
# the generator block, so the "this is generated" header docs/process.md §6 asks for
# cannot simply be typed into the file — it has to be re-stamped after every pull.
# Verified 2026-09-14: a hand-added header does not survive a single pull.
set -euo pipefail
cd "$(dirname "$0")/.."
SCHEMA='prisma/schema.prisma'
grep -q 'GENERATED FILE' "$SCHEMA" && exit 0
cat - "$SCHEMA" >"$SCHEMA.tmp" <<'HDR'
// GENERATED FILE — do not edit.
//
// Written by `npm run prisma:pull` from the live database, whose shape comes from the
// hand-written backend/db/schema.sql. Edit that file, apply it, and re-pull; edits made
// here are lost (docs/plan.md §2.1).

HDR
mv "$SCHEMA.tmp" "$SCHEMA"
