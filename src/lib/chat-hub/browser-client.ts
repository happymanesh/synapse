"use client";

import { createClient } from "@supabase/supabase-js";

// Browser-side client for chat-hub's Supabase project, Realtime only - never used for
// direct reads/writes (those stay server-side via src/lib/chat-hub/client.ts). See the
// NEXT_PUBLIC_CHAT_HUB_SUPABASE_* comment in .env for why this talks to chat-hub's
// Supabase project directly instead of through chat-hub's own API.
export const chatHubSupabase = createClient(
  process.env.NEXT_PUBLIC_CHAT_HUB_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_CHAT_HUB_SUPABASE_ANON_KEY!
);
