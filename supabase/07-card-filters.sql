-- Run ONCE in Supabase (SQL Editor -> New query -> paste -> Run). For the library's filters: by set, and Standard-legal only.
-- Afterwards run   npm run import:cards   in the mtg folder to fill the two columns for every card.
alter table public.cards
  add column if not exists printings text[] not null default '{}',          -- every set the card was printed in (lowercase codes)
  add column if not exists standard_legal boolean not null default false;   -- legal in Standard today (from Scryfall)

create index if not exists cards_printings_idx on public.cards using gin (printings);
create index if not exists cards_standard_idx on public.cards (id) where standard_legal;

-- Make the API see the new columns right away (otherwise the import says "Could not find the printings column ... in the schema cache").
notify pgrst, 'reload schema';
