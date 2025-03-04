import Fastify from "fastify";
import WebSocket from "ws";
import dotenv from "dotenv";
import fastifyFormBody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";
import { app } from "./index.js";  // Import the app without starting it

dotenv.config();

const PORT = process.env.PORT || 8000;

// Only start the server if we're running locally
if (!process.env.VERCEL) {
  app.listen({ port: PORT }, (err) => {
    if (err) {
      console.error("Error starting server:", err);
      process.exit(1);
    }
    console.log(`[Server] Listening on port ${PORT}`);
  });
}
