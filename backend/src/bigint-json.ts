// Prisma's mariadb driver returns MySQL integers as BigInt, which JSON.stringify
// throws on — verified here: `SELECT 1 AS one` gives `{ one: 1n }`. String rather
// than Number, because Number() corrupts anything above 2^53.
//
// Must load before anything serializes: main.ts imports it first, and the test
// script passes --import. Loom's own schema has no integer columns, so this is a
// net rather than a load-bearing conversion — but the wiring is the part that is
// expensive to add later.

declare global {
  interface BigInt {
    toJSON(): string
  }
}

BigInt.prototype.toJSON = function (this: bigint): string {
  return this.toString()
}
