#!/usr/bin/env node
/* eslint-env node */

/**
 * @description: Requests short-lived settings links from local or Fly-hosted Footnote runtimes.
 * @footnote-scope: utility
 * @footnote-module: OperatorLinkRequester
 * @footnote-risk: high - Incorrect request routing can fail settings access or target the wrong deployment.
 * @footnote-ethics: high - Operator links grant privileged settings edit access and must stay explicit.
 */

const http = require('node:http');
const { spawnSync } = require('node:child_process');

const OPERATOR_LINK_PATH = '/api/setup/operator-link';
const OPERATOR_REQUEST_HEADER = 'x-footnote-operator-request';
const OPERATOR_REQUEST_HEADER_VALUE = 'cli';

const extractJsonObject = (source) => {
    const trimmed = source.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        return JSON.parse(trimmed);
    }
    const lines = trimmed.split(/\r?\n/).reverse();
    for (const line of lines) {
        const candidate = line.trim();
        if (candidate.startsWith('{') && candidate.endsWith('}')) {
            return JSON.parse(candidate);
        }
    }
    throw new Error(`No JSON response found in command output: ${trimmed}`);
};

const requestLocalOperatorLink = ({ port, action }) =>
    new Promise((resolve, reject) => {
        const body = JSON.stringify({ action });
        const request = http.request(
            {
                hostname: '127.0.0.1',
                port,
                path: OPERATOR_LINK_PATH,
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    [OPERATOR_REQUEST_HEADER]: OPERATOR_REQUEST_HEADER_VALUE,
                    'content-length': Buffer.byteLength(body),
                },
            },
            (response) => {
                const chunks = [];
                response.on('data', (chunk) => chunks.push(chunk));
                response.on('end', () => {
                    const raw = Buffer.concat(chunks).toString('utf8');
                    if (
                        (response.statusCode ?? 500) < 200 ||
                        (response.statusCode ?? 500) >= 300
                    ) {
                        reject(
                            new Error(
                                `Request failed with status ${response.statusCode}: ${raw}`
                            )
                        );
                        return;
                    }
                    try {
                        resolve(JSON.parse(raw));
                    } catch (error) {
                        reject(error);
                    }
                });
            }
        );
        request.on('error', reject);
        request.end(body);
    });

const requestFlyOperatorLink = ({ flyApp, action }) => {
    const body = JSON.stringify({ action }).replace(/'/g, "'\\''");
    const remoteCommand = [
        // Port 3000 matches internal_port in deploy/fly/server.toml.
        'curl -fsS -X POST http://127.0.0.1:3000/api/setup/operator-link',
        "-H 'content-type: application/json'",
        `-H '${OPERATOR_REQUEST_HEADER}: ${OPERATOR_REQUEST_HEADER_VALUE}'`,
        `--data '${body}'`,
    ].join(' ');
    const result = spawnSync(
        'fly',
        ['ssh', 'console', '-a', flyApp, '-C', remoteCommand],
        {
            encoding: 'utf8',
        }
    );
    if (result.error) {
        throw result.error;
    }
    if ((result.status ?? 1) !== 0) {
        throw new Error(
            `fly ssh console failed: ${result.stderr || result.stdout}`
        );
    }
    return extractJsonObject(result.stdout);
};

/**
 * requestOperatorLink asks a local or Fly-hosted Footnote runtime to mint a
 * short-lived setup link.
 *
 * @param {{
 *   target: 'local'|'fly',
 *   flyApp?: string,
 *   localPort: number,
 *   action: 'settings'|'reset'
 * }} options - Target and operator action routing options.
 * @returns {Promise<object>} Resolves to the operator-link response payload.
 */
const requestOperatorLink = async ({ target, flyApp, localPort, action }) => {
    if (target === 'fly') {
        return requestFlyOperatorLink({ flyApp, action });
    }
    return requestLocalOperatorLink({ port: localPort, action });
};

module.exports = {
    requestOperatorLink,
};
