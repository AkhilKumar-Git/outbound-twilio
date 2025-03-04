import Fastify from "fastify";
import WebSocket from "ws";
import dotenv from "dotenv";
import fastifyFormBody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";
import Twilio from "twilio";

// Load environment variables from .env file
dotenv.config();

// Check for required environment variables
const {
  ELEVENLABS_API_KEY,
  ELEVENLABS_AGENT_ID,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
} = process.env;

if (
  !ELEVENLABS_API_KEY ||
  !ELEVENLABS_AGENT_ID ||
  !TWILIO_ACCOUNT_SID ||
  !TWILIO_AUTH_TOKEN ||
  !TWILIO_PHONE_NUMBER
) {
  console.error("Missing required environment variables");
  throw new Error("Missing required environment variables");
}

// Initialize Fastify server
const app = Fastify({
  logger: true,
  disableRequestLogging: true,
  ignoreTrailingSlash: true
});

// Add CORS support
app.addHook('onRequest', async (request, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,UPGRADE');
  reply.header('Access-Control-Allow-Headers', '*');
  reply.header('Access-Control-Allow-Credentials', 'true');
  
  if (request.method === 'OPTIONS') {
    reply.status(204).send();
    return;
  }
});

// Register plugins
app.register(fastifyFormBody);
app.register(fastifyWs, {
  options: {
    clientTracking: true,
    verifyClient: (info, cb) => {
      cb(true); // Accept all connections for now
    }
  }
});

// Export the app instance for serverless use
export default async (req, res) => {
  await app.ready();
  if (req.method === 'GET' && req.headers.upgrade?.toLowerCase() === 'websocket') {
    const upgrade = await app.inject({
      method: 'GET',
      url: req.url,
      headers: req.headers
    });
    if (upgrade.statusCode === 101) {
      res.writeHead(101, upgrade.headers);
      res.end();
      return;
    }
  }
  app.server.emit('request', req, res);
};

// Root route for health check
app.get("/", async (_, reply) => {
  reply.send({ message: "Server is running" });
});

// Initialize Twilio client
const twilioClient = new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Helper function to get signed URL for authenticated conversations
async function getSignedUrl() {
  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${ELEVENLABS_AGENT_ID}`,
      {
        method: "GET",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get signed URL: ${response.statusText}`);
    }

    const data = await response.json();
    return data.signed_url;
  } catch (error) {
    console.error("Error getting signed URL:", error);
    throw error;
  }
}

// Route to initiate outbound calls
app.post("/outbound-call", async (request, reply) => {
  const { number, prompt, first_message } = request.body;

  if (!number) {
    return reply.code(400).send({ error: "Phone number is required" });
  }

  try {
    const call = await twilioClient.calls.create({
      from: TWILIO_PHONE_NUMBER,
      to: number,
      url: `https://${
        request.headers.host
      }/outbound-call-twiml?prompt=${encodeURIComponent(
        prompt
      )}&first_message=${encodeURIComponent(first_message)}`,
    });

    reply.send({
      success: true,
      message: "Call initiated",
      callSid: call.sid,
    });
  } catch (error) {
    console.error("Error initiating outbound call:", error);
    reply.code(500).send({
      success: false,
      error: "Failed to initiate call",
    });
  }
});

// TwiML route for outbound calls
app.all("/outbound-call-twiml", async (request, reply) => {
  const prompt = request.query.prompt || "";
  const first_message = request.query.first_message || "";

  // Ensure we use the Vercel deployment URL
  const vercelUrl = process.env.VERCEL_URL || request.headers.host;
  const isVercel = !!process.env.VERCEL;

  // Use different TwiML for Vercel vs local development
  const twimlResponse = isVercel 
    ? `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say>Hello</Say>
          <Gather input="speech" timeout="5" action="/process-speech">
            <Say>${first_message}</Say>
          </Gather>
        </Response>`
    : `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Connect>
            <Stream url="wss://${vercelUrl}/outbound-media-stream">
              <Parameter name="prompt" value="${prompt}" />
              <Parameter name="first_message" value="${first_message}" />
            </Stream>
          </Connect>
        </Response>`;

  reply.type("text/xml").send(twimlResponse);
});

// Speech processing endpoint for Vercel deployment
app.post("/process-speech", async (request, reply) => {
  const speechResult = request.body.SpeechResult;
  
  try {
    // Get a signed URL for WebSocket connection
    const signedUrl = await getSignedUrl();
    
    // Create WebSocket connection
    const ws = new WebSocket(signedUrl);
    
    // Promise to handle the conversation
    const conversationPromise = new Promise((resolve, reject) => {
      let audioResponse = null;
      
      ws.on('open', () => {
        console.log('WebSocket connected');
        // Send initial configuration
        const initialConfig = {
          type: "conversation_initiation_client_data",
          conversation_config_override: {
            agent: {
              prompt: {
                prompt: "you are a helpful AI assistant"
              },
            },
          },
        };
        ws.send(JSON.stringify(initialConfig));
        
        // Send user's speech input
        const textMessage = {
          type: "text",
          text: speechResult
        };
        console.log('Sending text message:', textMessage);
        ws.send(JSON.stringify(textMessage));
      });
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          console.log('Received message type:', message.type);
          
          if (message.type === 'audio' && (message.audio?.chunk || message.audio_event?.audio_base_64)) {
            audioResponse = message.audio?.chunk || message.audio_event?.audio_base_64;
            ws.close();
            resolve(audioResponse);
          }
        } catch (error) {
          console.error('Error processing WebSocket message:', error);
        }
      });
      
      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      });
      
      // Set a timeout
      setTimeout(() => {
        ws.close();
        reject(new Error('Conversation timeout'));
      }, 10000);
    });
    
    // Wait for the audio response
    const audioData = await conversationPromise;
    
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Play>data:audio/mpeg;base64,${audioData}</Play>
        <Gather input="speech" timeout="5" action="/process-speech">
          <Say>Please continue...</Say>
        </Gather>
      </Response>`;

    reply.type("text/xml").send(twimlResponse);
  } catch (error) {
    console.error("Error processing speech:", error);
    const errorResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say>Sorry, there was an error processing your request.</Say>
        <Hangup/>
      </Response>`;
    reply.type("text/xml").send(errorResponse);
  }
});

// WebSocket route for handling media streams
app.register(async function (instance) {
  instance.get(
    "/outbound-media-stream",
    { websocket: true },
    (ws, req) => {
      console.info("[Server] Twilio connected to outbound media stream");

      // Variables to track the call
      let streamSid = null;
      let callSid = null;
      let elevenLabsWs = null;
      let customParameters = null; // Add this to store parameters

      // Handle WebSocket errors
      ws.on("error", console.error);

      // Set up ElevenLabs connection
      const setupElevenLabs = async () => {
        try {
          const signedUrl = await getSignedUrl();
          elevenLabsWs = new WebSocket(signedUrl);

          elevenLabsWs.on("open", () => {
            console.log("[ElevenLabs] Connected to Conversational AI");

            // Send initial configuration with prompt and first message
            const initialConfig = {
              type: "conversation_initiation_client_data",
              conversation_config_override: {
                agent: {
                  prompt: {
                    prompt:
                      customParameters?.prompt ||
                      "you are a gary from the phone store",
                  },
                  first_message:
                    customParameters?.first_message ||
                    "hey there! how can I help you today?",
                },
              },
            };

            console.log(
              "[ElevenLabs] Sending initial config with prompt:",
              initialConfig.conversation_config_override.agent.prompt.prompt
            );

            // Send the configuration to ElevenLabs
            elevenLabsWs.send(JSON.stringify(initialConfig));
          });

          elevenLabsWs.on("message", data => {
            try {
              const message = JSON.parse(data);

              switch (message.type) {
                case "conversation_initiation_metadata":
                  console.log("[ElevenLabs] Received initiation metadata");
                  break;

                case "audio":
                  if (streamSid) {
                    if (message.audio?.chunk) {
                      const audioData = {
                        event: "media",
                        streamSid,
                        media: {
                          payload: message.audio.chunk,
                        },
                      };
                      ws.send(JSON.stringify(audioData));
                    } else if (message.audio_event?.audio_base_64) {
                      const audioData = {
                        event: "media",
                        streamSid,
                        media: {
                          payload: message.audio_event.audio_base_64,
                        },
                      };
                      ws.send(JSON.stringify(audioData));
                    }
                  } else {
                    console.log(
                      "[ElevenLabs] Received audio but no StreamSid yet"
                    );
                  }
                  break;

                case "interruption":
                  if (streamSid) {
                    ws.send(
                      JSON.stringify({
                        event: "clear",
                        streamSid,
                      })
                    );
                  }
                  break;

                case "ping":
                  if (message.ping_event?.event_id) {
                    elevenLabsWs.send(
                      JSON.stringify({
                        type: "pong",
                        event_id: message.ping_event.event_id,
                      })
                    );
                  }
                  break;

                case "agent_response":
                  console.log(
                    `[Twilio] Agent response: ${message.agent_response_event?.agent_response}`
                  );
                  break;

                case "user_transcript":
                  console.log(
                    `[Twilio] User transcript: ${message.user_transcription_event?.user_transcript}`
                  );
                  break;

                default:
                  console.log(
                    `[ElevenLabs] Unhandled message type: ${message.type}`
                  );
              }
            } catch (error) {
              console.error("[ElevenLabs] Error processing message:", error);
            }
          });

          elevenLabsWs.on("error", error => {
            console.error("[ElevenLabs] WebSocket error:", error);
          });

          elevenLabsWs.on("close", () => {
            console.log("[ElevenLabs] Disconnected");
          });
        } catch (error) {
          console.error("[ElevenLabs] Setup error:", error);
        }
      };

      // Set up ElevenLabs connection
      setupElevenLabs();

      // Handle messages from Twilio
      ws.on("message", message => {
        try {
          const msg = JSON.parse(message);
          if (msg.event !== "media") {
            console.log(`[Twilio] Received event: ${msg.event}`);
          }

          switch (msg.event) {
            case "start":
              streamSid = msg.start.streamSid;
              callSid = msg.start.callSid;
              customParameters = msg.start.customParameters; // Store parameters
              console.log(
                `[Twilio] Stream started - StreamSid: ${streamSid}, CallSid: ${callSid}`
              );
              console.log("[Twilio] Start parameters:", customParameters);
              break;

            case "media":
              if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                const audioMessage = {
                  user_audio_chunk: Buffer.from(
                    msg.media.payload,
                    "base64"
                  ).toString("base64"),
                };
                elevenLabsWs.send(JSON.stringify(audioMessage));
              }
              break;

            case "stop":
              console.log(`[Twilio] Stream ${streamSid} ended`);
              if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                elevenLabsWs.close();
              }
              break;

            default:
              console.log(`[Twilio] Unhandled event: ${msg.event}`);
          }
        } catch (error) {
          console.error("[Twilio] Error processing message:", error);
        }
      });

      // Handle WebSocket closure
      ws.on("close", () => {
        console.log("[Twilio] Client disconnected");
        if (elevenLabsWs?.readyState === WebSocket.OPEN) {
          elevenLabsWs.close();
        }
      });
    }
  );
});
