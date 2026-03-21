export interface Env {
  DOCollab: DurableObjectNamespace;
}

export class CollabRoom {
  constructor(private state: DurableObjectState) {}

  async fetch(request: Request) {
    const url = new URL(request.url);
    const upgrade = request.headers.get("Upgrade");
    if (upgrade !== "websocket") {
      return new Response("Expected websocket", { status: 400 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    this.handleConnection(server, url.pathname.slice(1));
    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleConnection(ws: WebSocket, docId: string) {
    const key = `doc:${docId}`;
    const current = (await this.state.storage.get<string>(key)) ?? "";

    ws.accept();
    ws.send(JSON.stringify({ type: "init", content: current }));

    ws.addEventListener("message", async (event) => {
      let data: any;
      try {
        data = JSON.parse(String(event.data || ""));
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }

      if (data?.type === "save" && typeof data.content === "string") {
        await this.state.storage.put(key, data.content);
        ws.send(JSON.stringify({ type: "saved" }));
      } else if (data?.type === "update" && typeof data.content === "string") {
        await this.state.storage.put(key, data.content);
        ws.send(JSON.stringify({ type: "update", content: data.content }));
      }
    });
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/ws/")) {
      const docId = url.pathname.slice("/ws/".length) || "default";
      const id = env.DOCollab.idFromName(docId);
      const stub = env.DOCollab.get(id);

      return stub.fetch("https://do/ws/" + docId, request);
    }

    return new Response("ok", { status: 200 });
  },
};
