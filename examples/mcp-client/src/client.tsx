import { useAgent } from "agents/react";
import { createRoot } from "react-dom/client";
import { useRef, useState } from "react";
import "./styles.css";
import type { State } from "./server";

interface Message {
  id: string;
  text: string;
  timestamp: Date;
  type: "incoming" | "outgoing";
}

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const mcpInputRef = useRef<HTMLInputElement>(null);
  const [mcpState, setMcpState] = useState<State>({
    servers: {},
    tools: [],
    prompts: [],
    resources: [],
  });

  const agent = useAgent({
    agent: "my-agent",
    name: "agent-for-testiasdfng?",
    onOpen: () => setIsConnected(true),
    onClose: () => setIsConnected(false),
    onStateUpdate: (state: State) => {
      setMcpState(state);
    },
  });

  function openPopup(authUrl: string) {
    window.open(
      authUrl, 
      'popupWindow',
      'width=600,height=800,resizable=yes,scrollbars=yes,toolbar=yes,menubar=no,location=no,directories=no,status=yes'
    );
  }

  const handleMcpSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!mcpInputRef.current || !mcpInputRef.current.value.trim()) return;

    const serverUrl = mcpInputRef.current.value;
    fetch(`${agent._pkurl.replace("ws://", "http://")}/add-mcp`, {
      method: "POST",
      body: JSON.stringify({ url: serverUrl }),
    });
    setMcpState({
      ...mcpState,
      servers: {
        ...mcpState.servers,
        placeholder: {
          url: serverUrl,
          state: "connecting",
        },
      },
    });
  };

  return (
    <div className="chat-container">
      <div className="status-indicator">
        <div className={`status-dot ${isConnected ? "connected" : ""}`} />
        {isConnected ? "Connected to server" : "Disconnected"}
      </div>

      <div className="mcp-servers">
        <form className="message-form" onSubmit={handleMcpSubmit}>
          <input
            type="text"
            ref={mcpInputRef}
            className="message-input"
            placeholder="MCP Server URL"
          />
          <button type="submit">Add MCP Server</button>
        </form>
      </div>

      <div className="messages-section">
        <h2>MCP Servers</h2>
        {Object.entries(mcpState.servers).map(([id, server]) => (
          <div key={id} className={`message incoming-message`}>
            <div>
              <div>URL: {server.url}</div>
              <div className="status-indicator">
                <div
                  className={`status-dot ${server.state === "ready" ? "connected" : ""}`}
                />
                {server.state} (id: {id})
              </div>
            </div>
            {server.state === "authenticating" && server.authUrl && (
              <button onClick={() => openPopup(server.authUrl as string)}>Authorize</button>
            )}
          </div>
        ))}
      </div>

      <div className="messages-section">
        <h2>Server Data</h2>
        <h3>Tools</h3>
        {mcpState.tools.map((tool) => (
          <div>
            <b>{tool.name}</b>
            <div className="code">{JSON.stringify(tool)}</div>
          </div>
        ))}

        <h3>Prompts</h3>
        {mcpState.prompts.map((prompt) => (
          <div>
            <b>{prompt.name}</b>
            <div className="code">{JSON.stringify(prompt)}</div>
          </div>
        ))}

        <h3>Resources</h3>
        {mcpState.resources.map((resource) => (
          <div>
            <b>{resource.name}</b>
            <div className="code">{JSON.stringify(resource)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
