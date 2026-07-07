// ═══════════════════════════════════════════════════════
// SUPABASE CONFIG
// ═══════════════════════════════════════════════════════
const SUPABASE_URL = 'https://bqcnzzjeohacldhvvphm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ShX3ATAMIfUReY2nQH_74A_JkvoR9S6';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// Current signed-in user
let sbUser = null;
