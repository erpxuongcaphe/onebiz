import "@testing-library/jest-dom";

// Test env vars cho Supabase client (createBrowserClient throw nếu thiếu).
// Dùng URL/key dummy — tests dùng mock không gọi real API.
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
}
if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
}
