import {
  Agent,
  routeAgentRequest,
  type AgentNamespace,
  type Connection,
  type ConnectionContext,
} from "agents";
import { MCPClientManager } from "agents/mcp/client";
import type { Tool, Prompt, Resource } from "@modelcontextprotocol/sdk/types.js"

type Env = {
  MyAgent: AgentNamespace<MyAgent>;
  CLIENT_OAUTH_NAMESPACE: KVNamespace;
};

export type Server = {
  url: string;
  state: "authenticating" | "connecting" | "ready" | "discovering" | "failed";
  authUrl?: string;
};

export type State = {
  servers: Record<string, Server>;
  tools: (Tool & { serverId: string })[],
  prompts: (Prompt & { serverId: string })[],
  resources: (Resource & { serverId: string })[],
};

export class MyAgent extends Agent<Env, State> {
  initialState = {
    servers: {},
    tools: [],
    prompts: [],
    resources: []
  };
  private mcp_: MCPClientManager | undefined;

  constructor(
    public ctx: DurableObjectState,
    public env: Env
  ) {
    super(ctx, env);
  }

  async onStart(): Promise<void> {
    this.mcp_ = new MCPClientManager("my-agent", "1.0.0", {
      baseCallbackUri: `http://localhost:5173/agents/my-agent/${this.name}/callback`,
      kv: this.env.CLIENT_OAUTH_NAMESPACE,
    });
    this.refreshServers();
    this.refreshTools()
  }

  setServerState(id: string, state: Server) {
    this.setState({
      ...this.state,
      servers: {
        ...this.state.servers,
        [id]: state,
      },
    });
  }

  async refreshServers(): Promise<void> {
    for (const [id, server] of Object.entries(this.state.servers)) {
      try {
        const { authUrl } = await this.mcp.connect(server.url, { id });
        this.setServerState(id, {
          url: server.url,
          authUrl,
          state: this.mcp.mcpConnections[id].connectionState,
        });
      } catch (e) {
        console.log("Failed to initialize server: ", server);
        console.log(e);
      }
    }
  }

  async refreshTools() {
    this.setState({
      ...this.state,
      prompts: this.mcp.listPrompts(),
      tools: this.mcp.listTools(),
      resources: this.mcp.listResources()
    })
  }

  get mcp(): MCPClientManager {
    if (!this.mcp_) {
      throw new Error("MCPClientManager not initialized");
    }

    return this.mcp_;
  }

  async addMcpServer(url: string): Promise<string> {
    console.log(`Registering server: ${url}`);
    const { id, authUrl } = await this.mcp.connect(url, {});
    this.setServerState(id, {
      url,
      authUrl,
      state: this.mcp.mcpConnections[id].connectionState,
    })
    return authUrl ?? "";
  }

  async onConnect(connection: Connection<unknown>, ctx: ConnectionContext) {
    await this.refreshTools()
  }

  async onRequest(request: Request): Promise<Response> {
    if (this.mcp.isCallbackRequest(request)) {
      try {
        const { serverId } = await this.mcp.handleCallbackRequest(request)
        this.setServerState(serverId, {
          url: this.state.servers[serverId].url,
          state: this.mcp.mcpConnections[serverId].connectionState,
        })
        await this.refreshTools()
        // Hack: autoclosing window because a redirect fails for some reason
        // return Response.redirect('http://localhost:5173/', 301)
        return new Response("Authenticated<script>setTimeout(() => window.close(), 250);</script>", { status: 200, headers: { "content-type": "text/html" } })
      } catch (e: any) {
        return new Response(e, { status: 401 })
      }
    }

    if (request.url.endsWith("add-mcp") && request.method === "POST") {
      const mcpServer = await request.json() as { url: string }
      const authUrl = await this.addMcpServer(mcpServer.url);
      return new Response(authUrl, { status: 200 });
    }

    const timestamp = new Date().toLocaleTimeString();
    return new Response(
      `Server time: ${timestamp} - Your request has been processed!`,
      {
        headers: {
          "Content-Type": "text/plain",
        },
      }
    );
  }
}

export default {
  async fetch(request: Request, env: Env) {
    if (request.url.endsWith("asdf")) {
      console.log("redirect")
      return Response.redirect('http://localhost:5173/', 301)
    }

    return (
      (await routeAgentRequest(request, env, { cors: true })) ||
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
