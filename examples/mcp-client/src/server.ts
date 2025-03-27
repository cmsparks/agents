import {
  Agent,
  routeAgentRequest,
  type AgentNamespace,
  type Connection,
} from "agents";

type Env = {
  MCP_SERVERS: { host: string; info: { name: string; version: string } }[];
  MyAgent: AgentNamespace<MyAgent>;
};

export class MyAgent extends Agent<Env> {
  constructor(
    public ctx: DurableObjectStorage,
    public env: Env
  ) {
    super(ctx, env);
  }

  async onStart(): Promise<void> {
    await Promise.all(
      this.env.MCP_SERVERS.map((server) => {
        return this.connectToMCPServer(
          new URL(`${server.host}/sse`),
          server.info
        );
      })
    );
  }

  onConnect(connection: Connection) {
    console.log("Client connected:", connection.id);
    connection.send(`Welcome! You are connected with ID: ${connection.id}`);
    connection.send(
      `The following MCP servers are connected: ${Object.keys(this.MCPConnections).join(", ")}`
    );
    connection.send(`Available tools: ${JSON.stringify(this.listTools())}`);
    connection.send(
      `Available resources: ${JSON.stringify(this.listResources())}`
    );
    connection.send(`Available prompts: ${JSON.stringify(this.listPrompts())}`);
  }

  onClose(connection: Connection) {
    console.log("Client disconnected:", connection.id);
  }

  onMessage(connection: Connection, message: string) {
    console.log(`Message from client ${connection.id}:`, message);

    // Echo the message back with a timestamp
    const response = `Server received "${message}" at ${new Date().toLocaleTimeString()}`;
    connection.send(response);
    console.log("response sent to client:", response);

    // Broadcast to other clients
    for (const conn of this.getConnections()) {
      if (conn.id !== connection.id) {
        conn.send(`Client ${connection.id} says: ${message}`);
      }
    }
  }

  onRequest(request: Request): Response | Promise<Response> {
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
    return (
      (await routeAgentRequest(request, env, { cors: true })) ||
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
