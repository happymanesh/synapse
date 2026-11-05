"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Browser-side client for chat-hub's Supabase project, Realtime only - never used for
// direct reads/writes (those stay server-side via src/lib/chat-hub/client.ts). See the
// NEXT_PUBLIC_CHAT_HUB_SUPABASE_* comment in .env for why this talks to chat-hub's
// Supabase project directly instead of through chat-hub's own API.
//
// Built lazily and allowed to be absent. The previous version called createClient() at
// module scope with non-null assertions, so an environment without the variables threw
// "supabaseUrl is required" while the module was being evaluated — which took down every
// page rendering the app shell, not just the chat bell. That is exactly what happened in
// production: these are NEXT_PUBLIC_* variables, inlined at BUILD time, so a rebuild on a
// host that no longer had them baked in `undefined` and the dashboard stopped loading.
//
// chat-hub is an optional integration. Its absence must cost its own feature and nothing
// else, the same way the server-side client already logs and skips when unconfigured.

const url = process.env.NEXT_PUBLIC_CHAT_HUB_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_CHAT_HUB_SUPABASE_ANON_KEY;

let client: SupabaseClient | null | undefined;

/** The Realtime client, or null when chat-hub's Supabase project is not configured. */
export function getChatHubSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  if (!url || !anonKey) {
    console.info("[chat-hub] Supabase Realtime not configured; live updates are off.");
    client = null;
    return null;
  }
  client = createClient(url, anonKey);
  return client;
}

/** Whether live updates are available at all, for callers that want to skip the work. */
export const chatHubRealtimeConfigured = Boolean(url && anonKey);
