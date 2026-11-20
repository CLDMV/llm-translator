/**
 * The `X-Amz-Date` form of a time: `YYYYMMDD'T'HHMMSS'Z'`.
 * @param {Date} date - The time.
 * @returns {string} Basic ISO 8601 UTC time.
 */
export function stamp(date: Date): string;
/**
 * Sign a request with Signature Version 4. Every header given is signed, together with `host`, `x-amz-date` and, when there is a session
 * token, `x-amz-security-token`. The body is signed as the hash of the exact text or bytes passed in, so it must be what is sent.
 * @param {object} request - The request.
 * @param {string} [request.method] - HTTP method (default `GET`).
 * @param {string} request.url - Absolute URL as it will be requested.
 * @param {Record<string,string>} [request.headers] - Headers that will be sent (names in any case).
 * @param {string | Uint8Array} [request.body] - Body that will be sent (default empty).
 * @param {string} request.region - AWS region of the credential scope.
 * @param {string} request.service - Service of the credential scope (`bedrock` for Amazon Bedrock).
 * @param {string} request.accessKeyId - Access key id.
 * @param {string} request.secretAccessKey - Secret access key.
 * @param {string} [request.sessionToken] - Session token of temporary credentials.
 * @param {Date} [request.date] - Signing time (default now).
 * @returns {{headers: Record<string,string>, authorization: string, signature: string, signedHeaders: string, canonicalRequest: string, stringToSign: string}} The headers to send (the ones given plus `x-amz-date`, `x-amz-security-token` and `authorization`; `host` is left to the transport) and the intermediate values, which tests compare with published ones.
 */
export function sign({ method, url, headers, body, region, service, accessKeyId, secretAccessKey, sessionToken, date }: {
    method?: string;
    url: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array;
    region: string;
    service: string;
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    date?: Date;
}): {
    headers: Record<string, string>;
    authorization: string;
    signature: string;
    signedHeaders: string;
    canonicalRequest: string;
    stringToSign: string;
};
