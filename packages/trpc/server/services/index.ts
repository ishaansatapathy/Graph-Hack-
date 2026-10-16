import { AuthService, UserService } from "@stackfox/services";

export const authService = new AuthService();
export const userService = new UserService();

export { getFalkorClient, getGraph, pingFalkorDb } from "./falkordb";
