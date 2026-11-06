/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_APP_URL?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_OPERATOR_NAME?: string;
  readonly VITE_CONTACT_EMAIL?: string;
}
