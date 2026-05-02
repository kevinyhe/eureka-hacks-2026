const Network = (() => {
  let socket = null;
  let currentServerIp = null;

  const api = {
    onData: (id, data) => {},

    init(serverIp) {
      if (!serverIp) {
        throw new Error("Network.init(serverIp) requires a server IP address");
      }

      currentServerIp = serverIp;

      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
      }

      socket = new WebSocket(`ws://${serverIp}:8765`);

      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "register", role: "dashboard" }));
      });

      socket.addEventListener("message", (event) => {
        let payload;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }

        const id = payload.id ?? payload.deviceId ?? payload.sourceId ?? null;
        const data = payload.data ?? payload;
        api.onData(id, data);
      });

      socket.addEventListener("close", () => {
        socket = null;
      });

      socket.addEventListener("error", () => {
        // Intentionally left as a hook point for higher-level callers.
      });

      return socket;
    },

    get socket() {
      return socket;
    },

    get serverIp() {
      return currentServerIp;
    },
  };

  return api;
})();

export { Network };

if (typeof window !== "undefined") {
  window.Network = Network;
}
