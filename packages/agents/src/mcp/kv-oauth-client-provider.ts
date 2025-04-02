
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import type { OAuthTokens, OAuthClientMetadata, OAuthClientInformation, OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js"

// A slight extension to the standard OAuthClientProvider interface because `redirectToAuthorization` doesn't give us the interface we need
export interface AgentsOAuthProvider extends OAuthClientProvider {
  authUrl: string | undefined
}

export class KVOAuthClientProvider implements AgentsOAuthProvider {
  private authUrl_: string | undefined
  constructor(private kvNamespace: KVNamespace, private clientName: string, private sessionId: string, private redirectUrl_: string) {}

  get redirectUrl(): string {
    return this.redirectUrl_;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: this.clientName,
      client_uri: "example.com",
    }
  }

  get keyPrefix() {
    return `/${this.clientName}/${this.sessionId}`
  }

  get clientInfoKey() {
    return `${this.keyPrefix}/client_info`
  }
  
  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    return await this.kvNamespace.get<OAuthClientInformation>(this.clientInfoKey, "json") ?? undefined
  }

  async saveClientInformation(clientInformation: OAuthClientInformationFull): Promise<void> {
    // We only set these once, because for some reason the client sends the server multiple requests for this info
    if (await this.clientInformation() === undefined) {
      await this.kvNamespace.put(this.clientInfoKey, JSON.stringify(clientInformation))
    }
  }

  get tokenKey() {
    return `${this.keyPrefix}/token`
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const tokens = await this.kvNamespace.get<OAuthTokens>(this.tokenKey, "json") ?? undefined;
    return tokens
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    if (await this.tokens() === undefined) {
      await this.kvNamespace.put(this.tokenKey, JSON.stringify(tokens))
    }
  }

  get authUrl() {
    return this.authUrl_
  }

  /**
   * Because this operates on the server side (but we need browser auth), we send this url back to the user 
   * and require user interact to initiate the redirect flow 
   */
  async redirectToAuthorization(authUrl: URL): Promise<void> {
    if (this.authUrl_ === undefined) {
      this.authUrl_ = authUrl.toString()
    }
  }

  get codeVerifierKey() {
    return `${this.keyPrefix}/code_verifier`
  }

  async saveCodeVerifier(verifier: string): Promise<void> {
    if (!await this.kvNamespace.get(this.codeVerifierKey, "text")) {
      await this.kvNamespace.put(this.codeVerifierKey, verifier)
    }
  }

  async codeVerifier(): Promise<string> {
    const codeVerifier = await this.kvNamespace.get(this.codeVerifierKey, "text")
    if (!codeVerifier) {
      throw new Error("No code verifier found")
    }
    return codeVerifier
  }
}
