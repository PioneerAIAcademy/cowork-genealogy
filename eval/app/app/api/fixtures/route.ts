import { NextResponse } from 'next/server';
import { listFixtures } from '@/lib/fs/fixtures';

export async function GET() {
  const { fixtures, corrupt } = await listFixtures();
  return NextResponse.json({ fixtures, corrupt });
}
