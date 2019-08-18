import express from "express";
import next from "next";
import http from "http";
import url from "url";
import ShareDB from "sharedb";
import WebSocket from "ws";
import uuid from "uuid/v1";
import WebSocketJSONStream from "@teamwork/websocket-json-stream";
import PubSub from "./lib/pubsub";

const port = parseInt(process.env.PORT, 10) || 3000;

const dev = process.env.NODE_ENV !== "production";
const nextApp = next({ dev });
const handle = nextApp.getRequestHandler();

const backend = new ShareDB({
  disableDocAction: true,
  disableSpaceDelimitedActions: true
});

// backend.use("connect", (context, callback) => {
//   const { clientId } = context.agent;
//   // TODO Fetch users document
//   // TODO send op for adding current agent clientId as userId
//   console.log(`backend connect: ${clientId}`);
//   callback();
// });

// backend.use("receive", (request, callback) => {
//   console.log(" receive");
//   console.log(request.agent.custom);
//   callback();
// });

// backend.use("disconnect", (context, callback) => {
//   const { clientId } = context.agent;
//   // TODO Fetch users document
//   // TODO send op for adding current agent clientId as userId
  
//   callback();
// });

function fetchOrCreate(connection, documentId, defaultValue, callback) {
  const doc = connection.get("flok", documentId);
  doc.fetch(err => {
    if (err) throw err;
    if (doc.type === null) {
      doc.create(defaultValue, callback);
      return;
    }
    callback();
  });
}

// Create initial documents
function createDoc(callback) {
  const connection = backend.connect();

  fetchOrCreate(connection, "users", {}, callback);

  // connection.on('connected', (...args) => {
  //   console.log(`Connected ${JSON.stringify(args)}`);
  // });

  // connection.on('stopped', (...args) => {
  //   console.log(`Disconnected ${JSON.stringify(args)}`);
  // });
}

function startServer() {
  nextApp.prepare().then(() => {
    const app = express();
    const wss = new WebSocket.Server({ noServer: true });
    const evalWss = new WebSocket.Server({ noServer: true });
    const server = http.createServer(app);

    server.on("upgrade", (request, socket, head) => {
      const { pathname } = url.parse(request.url);

      if (pathname === "/db") {
        wss.handleUpgrade(request, socket, head, ws => {
          wss.emit("connection", ws);
        });
      } else if (pathname === "/eval") {
        evalWss.handleUpgrade(request, socket, head, ws => {
          evalWss.emit("connection", ws);
        });
      } else {
        socket.destroy();
      }
    });

    // Connect any incoming WebSocket connection to ShareDB
    wss.on("connection", ws => {
      const stream = new WebSocketJSONStream(ws);
      backend.listen(stream);

      const clientId = uuid();
      console.log(`Connected: ${clientId}`);
      stream.write({ _type: "connected", value: clientId });

      stream.on("close", () => {
        console.log(`Disconnected: ${clientId}`);
      })
    });

    // wss.on("disconnection", ws => {
    //   console.log(`Disconnect: ${JSON.stringify(ws.clientId)}`);
    //   removeCurrentUser()
    // })

    // Prepare evaluation WebScoket server (pubsub)
    const pubSubServer = new PubSub({ wss: evalWss });
    // eslint-disable-next-line no-param-reassign
    app.pubsub = pubSubServer;

    // Let Next to handle everything else
    app.get("*", (req, res) => {
      return handle(req, res);
    });

    server.listen(port, err => {
      if (err) throw err;
      // eslint-disable-next-line no-console
      console.log(`> Ready on http://localhost:${port}`);
    });
  });
}

createDoc(startServer);
