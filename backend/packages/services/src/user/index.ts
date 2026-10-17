import { env } from "../env";
import { isGoogleOAuthConfigured } from "../clients/google-oauth";
import type { GetAuthenticationMethodOutputSchema } from "./model";

class UserService {
  public async getAuthenticationMethods(): Promise<
    ReadonlyArray<GetAuthenticationMethodOutputSchema>
  > {
    const supportedAuthenticationProviders: GetAuthenticationMethodOutputSchema[] = [];

    if (isGoogleOAuthConfigured()) {
      supportedAuthenticationProviders.push({
        provider: "GOOGLE_OAUTH",
        displayName: "Google",
        displayText: "Continue with Google",
        authUrl: `${env.CLIENT_URL}/api-auth/google`,
      });
    }

    return supportedAuthenticationProviders;
  }
}

export default UserService;
