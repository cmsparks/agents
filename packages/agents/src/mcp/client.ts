import { MCPClientConnection } from "./client-connection";

import type {
  ClientCapabilities,
  CallToolRequest,
  CallToolResultSchema,
  CompatibilityCallToolResultSchema,
  ReadResourceRequest,
  GetPromptRequest,
  Tool,
  Resource,
  Prompt,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/types.js";
import type { SSEClientTransportOptions } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { KVOAuthClientProvider, type AgentsOAuthProvider } from "./kv-oauth-client-provider";

/**
 * Utility class that aggregates multiple MCP clients into one
 */
export class MCPClientManager {
  public mcpConnections: Record<string, MCPClientConnection> = {};

  /**
   * @param name Name of the MCP client
   * @param version Version of the MCP Client
   * @param auth Auth paramters if being used to create a KVOAuthClientProvider
   */
  constructor(private name: string, private version: string, private auth?: { baseCallbackUri: string, kv: KVNamespace }) {}

  /**
   * Connect to and register an MCP server
   *
   * @param transportConfig Transport config
   * @param clientConfig Client config
   * @param capabilities Client capabilities (i.e. if the client supports roots/sampling)
   */
  async connect(
    url: string,
    opts: {
      // setting `id` allows us to reconnect to an already authenticated server
      id?: string,
      // we're overriding authProvider here because we want to be able to access the auth URL
      transport?: SSEClientTransportOptions & { authProvider: AgentsOAuthProvider },
      client?: ConstructorParameters<typeof Client>[1],
      capabilities?:ClientCapabilities,
    } = {}
  ): Promise<{ id: string, authUrl: string | undefined }> {
    // 
    const id = opts.id ?? crypto.randomUUID()

    // if we have global auth for the manager AND there's no authProvider override
    // then let's setup an auth provider
    const authProvider: AgentsOAuthProvider | undefined = this.auth ? 
      new KVOAuthClientProvider(this.auth.kv, this.name, id, `${this.auth.baseCallbackUri}/${id}`) :
      opts.transport?.authProvider

    this.mcpConnections[id] = new MCPClientConnection(new URL(url), {
      name: this.name,
      version: this.version
    }, {
      transport: {
        ...opts.transport,
        authProvider
      },
      client: opts.client ?? {},
      capabilities: opts.client ?? {},
    });

    await this.mcpConnections[id].init();

    return { 
      id,
      authUrl: authProvider?.authUrl,
    }
  }

  isCallbackRequest(req: Request): boolean {
    if (this.auth?.baseCallbackUri) {
      return req.url.startsWith(this.auth.baseCallbackUri) && req.method === "GET"
    }
    return false
  }

  async handleCallbackRequest(req: Request) {
    const url = new URL(req.url)
    const code = url.searchParams.get("code")
    let serverId = req.url.replace(this.auth!.baseCallbackUri, "").split("?")[0]
    serverId = serverId.replaceAll("/", "")
    console.log(code)
    console.log(serverId)
    if (!code) {
      throw new Error("Unauthorized: no code provided")
    }

    await this.finishAuth(serverId, code)

    return { serverId }
  }

  async finishAuth(serverId: string, code: string) {
    if (this.mcpConnections[serverId].connectionState !== "authenticating") {
      throw new Error("Failed to authenticate: the client isn't in the `authenticating` state")
    }
    await this.mcpConnections[serverId].init(code)
    if (this.mcpConnections[serverId].connectionState === "authenticating") {
      throw new Error("Failed to authenticate: client failed to initialize")
    }
  }

  /**
   * @returns namespaced list of tools
   */
  listTools(): NamespacedData["tools"] {
    return getNamespacedData(this.mcpConnections, "tools");
  }

  /**
   * @returns namespaced list of prompts
   */
  listPrompts(): NamespacedData["prompts"] {
    return getNamespacedData(this.mcpConnections, "prompts");
  }

  /**
   * @returns namespaced list of tools
   */
  listResources(): NamespacedData["resources"] {
    return getNamespacedData(this.mcpConnections, "resources");
  }

  /**
   * @returns namespaced list of resource templates
   */
  listResourceTemplates(): NamespacedData["resourceTemplates"] {
    return getNamespacedData(this.mcpConnections, "resourceTemplates");
  }

  /**
   * Namespaced version of callTool
   */
  callTool(
    params: CallToolRequest["params"] & { serverId: string },
    resultSchema:
      | typeof CallToolResultSchema
      | typeof CompatibilityCallToolResultSchema,
    options: RequestOptions
  ) {
    const unqualifiedName = params.name.replace(`${params.serverId}.`, "");
    return this.mcpConnections[params.serverId].client.callTool(
      {
        ...params,
        name: unqualifiedName,
      },
      resultSchema,
      options
    );
  }

  /**
   * Namespaced version of readResource
   */
  readResource(
    params: ReadResourceRequest["params"] & { serverId: string },
    options: RequestOptions
  ) {
    return this.mcpConnections[params.serverId].client.readResource(
      params,
      options
    );
  }

  /**
   * Namespaced version of getPrompt
   */
  getPrompt(
    params: GetPromptRequest["params"] & { serverId: string },
    options: RequestOptions
  ) {
    return this.mcpConnections[params.serverId].client.getPrompt(
      params,
      options
    );
  }
}

type NamespacedData = {
  tools: (Tool & { serverId: string })[];
  prompts: (Prompt & { serverId: string })[];
  resources: (Resource & { serverId: string })[];
  resourceTemplates: (ResourceTemplate & { serverId: string })[];
};

export function getNamespacedData<T extends keyof NamespacedData>(
  mcpClients: Record<string, MCPClientConnection>,
  type: T
): NamespacedData[T] {
  const sets = Object.entries(mcpClients).map(([name, conn]) => {
    return { name, data: conn[type] };
  });

  const namespacedData = sets.flatMap(({ name: serverId, data }) => {
    return data.map((item) => {
      return {
        ...item,
        // we add a serverId so we can easily pull it out and send the tool call to the right server
        serverId,
      };
    });
  });

  return namespacedData as NamespacedData[T]; // Type assertion needed due to TS limitations with conditional return types
}
