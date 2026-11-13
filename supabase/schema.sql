-- Quanto Vale? — banco de dados (rodar uma vez no SQL Editor do Supabase)

-- Quem pagou (preenchido pelo webhook da Korvex)
create table if not exists public.acessos (
  email text primary key,
  status text not null default 'inativo',      -- ativo | inativo
  plano text,
  expira_em timestamptz,
  atualizado_em timestamptz not null default now(),
  origem jsonb
);
alter table public.acessos enable row level security;
drop policy if exists "ver o proprio acesso" on public.acessos;
create policy "ver o proprio acesso" on public.acessos
  for select to authenticated using (lower(email) = lower(auth.jwt() ->> 'email'));

-- Itens salvos de cada pessoa
create table if not exists public.itens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  objeto text, estado text,
  rapido integer, justo integer, maximo integer,
  motivo text, confianca text, titulo text, descricao text,
  thumb text,
  criado_em timestamptz not null default now()
);
create index if not exists itens_user_idx on public.itens(user_id, criado_em desc);
alter table public.itens enable row level security;
drop policy if exists "dono le" on public.itens;
drop policy if exists "dono cria" on public.itens;
drop policy if exists "dono apaga" on public.itens;
create policy "dono le" on public.itens for select to authenticated using (user_id = auth.uid());
create policy "dono cria" on public.itens for insert to authenticated with check (user_id = auth.uid());
create policy "dono apaga" on public.itens for delete to authenticated using (user_id = auth.uid());

-- Contagem de avaliações (só o servidor mexe)
create table if not exists public.uso (
  user_id uuid not null references auth.users(id) on delete cascade,
  dia date not null default current_date,
  n integer not null default 0,
  primary key (user_id, dia)
);
alter table public.uso enable row level security;

create or replace function public.somar_uso(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  insert into public.uso(user_id, dia, n) values (p_user, current_date, 1)
  on conflict (user_id, dia) do update set n = public.uso.n + 1
  returning n into v;
  return v;
end $$;
revoke all on function public.somar_uso(uuid) from public, anon, authenticated;

-- Registro bruto dos avisos da Korvex (pra conferir)
create table if not exists public.webhooks_log (
  id bigserial primary key,
  recebido_em timestamptz not null default now(),
  corpo jsonb
);
alter table public.webhooks_log enable row level security;
