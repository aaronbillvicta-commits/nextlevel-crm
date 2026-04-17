-- ============================================================
-- CRM — Supabase Row Level Security (RLS) Setup
-- Run this entire file in your Supabase SQL Editor.
-- Go to: Supabase Dashboard → SQL Editor → New Query → Paste → Run
-- ============================================================

-- ── 1. Create user_integrations table ──
-- Stores API credentials (Twilio, email, Facebook, etc.) per user.
-- Replaces the old localStorage approach so secrets never live in the browser.

CREATE TABLE IF NOT EXISTS user_integrations (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid NOT NULL,
  key        text NOT NULL,        -- 'twilio', 'email', 'facebook', etc.
  data       jsonb DEFAULT '{}',   -- non-secret config (SID, phone number, etc.)
  secret     text DEFAULT '',      -- API key / auth token
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, key)
);

-- ── 2. Enable RLS on every table ──

ALTER TABLE contacts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipelines              ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_integrations      ENABLE ROW LEVEL SECURITY;

-- ── 3. RLS Policies ──
-- These assume your custom `users` table uses the same UUID as auth.users.
-- If your users.id is different from auth.uid(), replace auth.uid() with
-- a subquery like: (SELECT id FROM users WHERE auth_uid = auth.uid() LIMIT 1)

-- contacts: only the authenticated user can see/edit rows
DROP POLICY IF EXISTS "contacts_policy" ON contacts;
CREATE POLICY "contacts_policy" ON contacts
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- pipelines
DROP POLICY IF EXISTS "pipelines_policy" ON pipelines;
CREATE POLICY "pipelines_policy" ON pipelines
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- deals
DROP POLICY IF EXISTS "deals_policy" ON deals;
CREATE POLICY "deals_policy" ON deals
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- users: each user can read all users (needed for team view) but only edit their own row
DROP POLICY IF EXISTS "users_read_policy" ON users;
CREATE POLICY "users_read_policy" ON users
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "users_write_policy" ON users;
CREATE POLICY "users_write_policy" ON users
  FOR ALL USING (id::text = auth.uid()::text)
  WITH CHECK (id::text = auth.uid()::text);

-- custom field definitions
DROP POLICY IF EXISTS "custom_fields_policy" ON custom_field_definitions;
CREATE POLICY "custom_fields_policy" ON custom_field_definitions
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- user_integrations: each user can only manage their own credentials
DROP POLICY IF EXISTS "integrations_policy" ON user_integrations;
CREATE POLICY "integrations_policy" ON user_integrations
  FOR ALL USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ── 4. Grant anon key access (required for Supabase REST API) ──

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ── 5. Verify ──
-- After running, confirm RLS is ON for each table:
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
