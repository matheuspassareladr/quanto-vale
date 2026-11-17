-- Quanto Vale? — Indique e ganhe (rodar UMA vez no SQL Editor do Supabase, depois do schema.sql)

-- Código de indicação de cada pessoa
create table if not exists public.perfis (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  codigo text not null unique,
  criado_em timestamptz not null default now()
);
alter table public.perfis enable row level security;

-- Quem indicou quem
create table if not exists public.indicacoes (
  indicado_id uuid primary key references auth.users(id) on delete cascade,
  indicado_email text,
  indicador_id uuid not null references auth.users(id) on delete cascade,
  usou boolean not null default false,   -- o amigo fez a 1ª avaliação
  pagou boolean not null default false,  -- o amigo comprou o acesso
  criado_em timestamptz not null default now()
);
create index if not exists indicacoes_indicador_idx on public.indicacoes(indicador_id);
create index if not exists indicacoes_email_idx on public.indicacoes(indicado_email);
alter table public.indicacoes enable row level security;
-- Sem políticas: só o servidor (service role) lê e escreve.
