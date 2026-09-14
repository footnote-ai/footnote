/**
 * @description: Serves deterministic OpenAI-compatible responses for the local Turnstile browser suite.
 * @footnote-scope: test
 * @footnote-module: TurnstileE2EProvider
 * @footnote-risk: low - Test-only provider traffic is isolated to localhost.
 * @footnote-ethics: low - The fixture never handles production prompts or credentials.
 */

const http = require('node:http');

const port = Number(process.env.TURNSTILE_E2E_PROVIDER_PORT ?? '4545');

const readBody = (request) =>
    new Promise((resolve, reject) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => {
            body += chunk;
        });
        request.on('end', () => resolve(body));
        request.on('error', reject);
    });

const sendJson = (response, statusCode, payload) => {
    const body = JSON.stringify(payload);
    response.writeHead(statusCode, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
    });
    response.end(body);
};

const server = http.createServer(async (request, response) => {
    if (
        request.method !== 'POST' ||
        !request.url?.endsWith('/chat/completions')
    ) {
        sendJson(response, 404, { error: { message: 'Not found' } });
        return;
    }

    try {
        const body = JSON.parse(await readBody(request));
        const isStructured = body.response_format !== undefined;
        process.stdout.write(
            `turnstile-e2e-provider request structured=${String(isStructured)} model=${String(body.model ?? '')}\n`
        );
        const content = isStructured ? '{}' : 'Turnstile integration response.';
        sendJson(response, 200, {
            id: 'turnstile-e2e-completion',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: body.model ?? 'turnstile-e2e-model',
            choices: [
                {
                    index: 0,
                    message: { role: 'assistant', content },
                    finish_reason: 'stop',
                },
            ],
            usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
            },
        });
    } catch (error) {
        sendJson(response, 400, {
            error: {
                message: error instanceof Error ? error.message : String(error),
            },
        });
    }
});

server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`turnstile-e2e-provider listening on ${port}\n`);
});

const shutdown = () => {
    server.close(() => process.exit(0));
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
