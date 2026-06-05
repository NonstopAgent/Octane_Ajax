import { createHmac, timingSafeEqual } from 'crypto';

export interface OctanePayload {
  command: string;
  project: string;
  timestamp: number; // For replay attack protection (max 5 minute window)
  params: Record<string, any>;
}

export function generateOctaneSignature(payload: OctanePayload, secret: string): string {
  const data = JSON.stringify(payload);
  return createHmac('sha256', secret).update(data).digest('hex');
}

export function verifyOctaneRequest(
  payload: OctanePayload,
  incomingSignature: string,
  secret: string
): boolean {
  const fiveMinutesInMs = 5 * 60 * 1000;
  const now = Date.now();
  if (now - payload.timestamp > fiveMinutesInMs) {
    return false;
  }
  if (payload.timestamp - now > fiveMinutesInMs) {
    return false;
  }

  const expectedSignature = generateOctaneSignature(payload, secret);

  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const incomingBuffer = Buffer.from(incomingSignature, 'hex');

  if (expectedBuffer.length !== incomingBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, incomingBuffer);
}
