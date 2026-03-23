Schema:

create table users (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table markers (
  id text primary key,
  name text not null,
  description text,
  icon_id text not null,
  lat double precision not null,
  lng double precision not null,
  reg_id text not null,
  under_ground boolean not null default false,
  height double precision not null default 0,
  color_r integer not null default 255,
  color_g integer not null default 255,
  color_b integer not null default 255,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_identities (
  user_id bigint not null references users(id) on delete cascade,
  provider text not null,
  provider_user_id text not null,
  email text,
  unique (provider, provider_user_id),
  primary key (provider, provider_user_id),
  unique (user_id, provider)
);

create table user_profiles (
  user_id bigint primary key references users(id) on delete cascade,
  user_name text,
  display_name text,
  role text check (role in ('user','editor','moderator','admin')) default 'user'
);

create table user_collected_markers (
  user_id bigint references users(id) on delete cascade,
  marker_id text references markers(id) on delete cascade,
  collected_at timestamptz not null default now(),
  primary key (user_id, marker_id)
);

CREATE INDEX idx_markers_icon ON markers(icon_id);
CREATE INDEX idx_markers_region ON markers(reg_id);
CREATE INDEX idx_markers_under_ground ON markers(under_ground);
