-- Run ONCE in Supabase (SQL Editor -> New query -> paste -> Run).
-- Many more cards are playable now, so the random-deck lookup (playable creatures, instants and sorceries that cost 5 or less, in id order)
-- gets its own small index. Safe to run again.
create index if not exists cards_playable_spells_idx on public.cards (id) where playable and type in ('creature', 'instant', 'sorcery') and cost <= 5;
