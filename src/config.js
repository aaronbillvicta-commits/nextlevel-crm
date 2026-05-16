// NLM CRM — shared configuration constants
//
// MIGRATION NOTE (step 3 of the modular extraction):
// These values are temporarily DUPLICATED here AND inline in index.html
// (search for "SUPABASE CONFIG"). The inline copy is load-bearing today because
// line ~2597 of index.html reads SUPABASE_KEY at parse time, before this
// deferred module runs. Future modules should import from THIS file; the inline
// copy will be deleted once nothing reads it at parse time anymore.
//
// If you rotate the Supabase anon key: update BOTH locations until the inline
// copy is removed.

export const SUPABASE_URL = 'https://oipkvwdjlwienkphsivr.supabase.co';
export const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pcGt2d2RqbHdpZW5rcGhzaXZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxMzk2NTUsImV4cCI6MjA5MTcxNTY1NX0.VAj_i2iCnvd3qz9Emhh-O_eBywrmxYH9U2vJPVFclT0';

// Verification marker — in DevTools console after deploy, `window.__nlmConfigLoaded`
// should return `true`. If undefined, the module didn't load and the path/cache
// needs investigation.
window.__nlmConfigLoaded = true;
