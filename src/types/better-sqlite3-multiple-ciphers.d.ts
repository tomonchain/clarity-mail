// The package ships types, but its "exports" map hides them from TypeScript.
// Its API is better-sqlite3's, plus encryption pragmas.
declare module "better-sqlite3-multiple-ciphers" {
  import Database from "better-sqlite3";
  export = Database;
}
