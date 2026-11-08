-- Run ONCE in Supabase (SQL Editor -> New query -> paste -> Run). The Scribe's conversation history: each player's own, readable only by them.
create table if not exists public.scribe_chats (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default 'New conversation' check (char_length(title) <= 120),
  turns jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists scribe_chats_owner_idx on public.scribe_chats (owner, updated_at desc);

-- Row level security: a signed-in player sees and changes only their own rows. Nobody else can read them (not even another signed-in player).
alter table public.scribe_chats enable row level security;

drop policy if exists "scribe chats: owner reads" on public.scribe_chats;
drop policy if exists "scribe chats: owner writes" on public.scribe_chats;
drop policy if exists "scribe chats: owner updates" on public.scribe_chats;
drop policy if exists "scribe chats: owner deletes" on public.scribe_chats;
create policy "scribe chats: owner reads" on public.scribe_chats for select to authenticated using (owner = auth.uid());
create policy "scribe chats: owner writes" on public.scribe_chats for insert to authenticated with check (owner = auth.uid());
create policy "scribe chats: owner updates" on public.scribe_chats for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "scribe chats: owner deletes" on public.scribe_chats for delete to authenticated using (owner = auth.uid());

-- Make the API see the new table right away.
notify pgrst, 'reload schema';
