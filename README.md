# ElevenLabs Conversational AI - Twilio Integration (Javascript)

This demo shows how to integrate ElevenLabs Conversational AI with Twilio to create an interactive voice agent that can handle inbound and outbound phone calls.

## Prerequisites

- ElevenLabs API key.
- Twilio account & phone number.
- Node 16+.
- A static ngrok URL for local development.

## Quick Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment:

- Copy `.env.example` to `.env`: `cp .env.example .env`
- Add your ElevenLabs Agent ID and API key to the `.env` file

3. Start the server:

```bash
node index.js
```

4. In a new terminal, use ngrok to create a public URL:

```bash
ngrok http --url=<your-static-url> 8000
```

5. Configure your Twilio webhook:
   - Go to your Twilio Phone Number settings
   - Set the webhook URL for incoming calls to: `{your-ngrok-url}/twilio/inbound_call`
   - Make sure the HTTP method is set to POST

## Testing

1. Call your Twilio phone number
2. The agent should answer and begin the conversation
3. Monitor the console logs for any potential issues

### Outbound Call

1. Start the server: `node outbound.js`
1. `ngrok http --url=<your-static-url> 8000`
1. Make a request to the `/outbound-call` endpoint with the prompt you want to use:

```bash
curl -X POST https://5846-49-206-42-168.ngrok-free.app/outbound-call \
-H "Content-Type: application/json" \
-d '{
   "prompt": "You are Ria, a professional and empathetic AI Voice Agent for Revolt Motors. Your core objectives are: Make the caller feel comfortable and valued. Provide accurate information about Revolt Motors’ bikes and services, using the FAQ knowledge base. Guide callers toward booking a test drive or receiving service, without being overly pushy. Only answer using official data from the knowledge base to avoid hallucinating. If uncertain, politely offer to connect them with a human agent or direct them to official contact details.",
   "first_message": "Hello Hi",
   "number": "+919582025588"
   }'
```

## Troubleshooting

- Ensure the environment variable is properly set
- Check ngrok connection is active and URL is correct
- Verify Twilio webhook configuration
- Monitor server logs for detailed error messages

## Documentation

For detailed setup instructions and troubleshooting, please refer to the [official ElevenLabs Twilio Integration Guide](https://elevenlabs.io/docs/conversational-ai/guides/conversational-ai-twilio).

## License

This project is licensed under the MIT License - see the LICENSE file for details.