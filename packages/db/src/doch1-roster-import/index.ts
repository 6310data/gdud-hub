/**
 * The battalion's soldier list for the round being planned (Mode B of the דוח 1 import):
 * read xlsx / csv → parse → compare with the base round → (apply). Runs inside the battalion
 * admin's RLS transaction (withUser); the file is parsed in memory and never stored.
 */
export * from "./apply";
export * from "./corrections";
export * from "./parse";
export * from "./plan";
export * from "./read";
