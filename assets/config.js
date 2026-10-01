// Cloud sync settings (assets/cloud.js). Leave both empty and TakwimuBridge
// stays browser-only. The public key (Supabase "anon" / "publishable" key)
// is meant to ship to browsers — row-level security in the database is what
// keeps each researcher's projects private. Never put the secret
// (service_role) key here.
window.TB_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: ""
};
