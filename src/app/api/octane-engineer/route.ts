import { NextResponse } from 'next/server';
import { verifyOctaneRequest, OctanePayload } from '@/lib/octane-auth';

export async function POST(request: Request) {
  try {
    const signature = request.headers.get('x-octane-signature');
    if (!signature) {
      return NextResponse.json({ error: 'Unauthorized: Missing signature' }, { status: 401 });
    }

    const body: OctanePayload = await request.json();
    const secret = process.env.OCTANE_SHARED_SECRET;

    if (!secret) {
      return NextResponse.json({ error: 'Server misconfiguration: Missing secret' }, { status: 500 });
    }

    const isValid = verifyOctaneRequest(body, signature, secret);
    if (!isValid) {
      return NextResponse.json({ error: 'Unauthorized: Invalid signature or expired token' }, { status: 401 });
    }

    switch (body.command) {
      case 'sync_state':
        return NextResponse.json({ success: true, message: `Synced state for ${body.project}` });

      case 'trigger_pipeline':
        return NextResponse.json({ success: true, message: `Pipeline triggered: ${body.params.pipelineId}` });

      default:
        return NextResponse.json({ error: `Unknown command: ${body.command}` }, { status: 400 });
    }

  } catch (error) {
    console.error('[Octane Engineer Inbound Error]:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
