import { AuthService, UserService, checkDatabaseHealth, runDatabaseHousekeeping } from "@stackfox/services";

export const authService = new AuthService();
export const userService = new UserService();

export { checkDatabaseHealth, runDatabaseHousekeeping };
export { getFalkorClient, getGraph, pingFalkorDb } from "./falkordb";
