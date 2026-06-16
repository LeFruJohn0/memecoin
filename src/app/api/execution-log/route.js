import { NextResponse } from 'next/server';
import { getEventLog } from '../../../lib/execution.js';

export async function GET() {
  return NextResponse.json(getEventLog());
}
