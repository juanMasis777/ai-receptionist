-- Storage for the AI receptionist. Each row keeps the full record as JSON plus
-- the columns we filter or sort on. Only the server (service role / secret key)
-- reads or writes these tables: RLS is on and there are no public policies.

create table if not exists public.receptionist_bookings (
  id uuid primary key,
  business_id text not null,
  code text not null unique,
  status text not null default 'confirmed',
  date text not null,          -- YYYY-MM-DD in the business time zone
  time text not null,          -- HH:MM, 24-hour
  record jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists receptionist_bookings_business_date
  on public.receptionist_bookings (business_id, date);

create table if not exists public.receptionist_conversations (
  business_id text not null,
  id uuid not null,
  record jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (business_id, id)
);
create index if not exists receptionist_conversations_business_updated
  on public.receptionist_conversations (business_id, updated_at desc);

create table if not exists public.receptionist_notifications (
  id uuid primary key,
  business_id text not null,
  record jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists receptionist_notifications_business_created
  on public.receptionist_notifications (business_id, created_at desc);

alter table public.receptionist_bookings enable row level security;
alter table public.receptionist_conversations enable row level security;
alter table public.receptionist_notifications enable row level security;

-- Customer names and phone numbers: never reachable with the public (anon) key.
revoke all on public.receptionist_bookings, public.receptionist_conversations, public.receptionist_notifications
  from anon, authenticated;
