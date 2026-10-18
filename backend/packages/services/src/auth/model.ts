import { z } from "zod";

import { userRoleSchema } from "./roles";

export const authUserSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  displayName: z.string().nullable(),
  email: z.string().email(),
  emailVerified: z.boolean(),
  profileImageUrl: z.string().nullable(),
  twoFactorEnabled: z.boolean(),
  role: userRoleSchema,
});

export const messageOutputSchema = z.object({
  message: z.string(),
});

export type AuthUser = z.infer<typeof authUserSchema>;
export type MessageOutput = z.infer<typeof messageOutputSchema>;
