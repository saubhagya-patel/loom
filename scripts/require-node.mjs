// Node >= 24: type stripping is unflagged from 23.6, and Render's default is 24.21.
// A wrong node presents as something else entirely, which is the whole reason this exists.
// Under node 20, `npm run verify` fails at the test step with
// `Could not find '…/tests/unit/**/*.test.ts'` — node 20 cannot expand globs for --test — so a
// wrong runtime reads as missing test files and sends you looking at the glob, the script and
// the directory in turn. backend/tests/e2e/run.sh has guarded this since Phase 0; `verify` did
// not, and it bit again while closing that phase.
const major = Number(process.versions.node.split('.')[0])
if (major < 24) {
  console.error(`\nloom needs node >= 24, and this shell has ${process.version}.`)
  console.error('nvm loads after the Homebrew PATH exports in .zshrc, so a fresh shell gets the old one.')
  console.error('Fix for this shell:  export PATH="/opt/homebrew/opt/node/bin:$PATH"\n')
  process.exit(1)
}
