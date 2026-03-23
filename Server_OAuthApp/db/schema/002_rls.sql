alter table markers enable row level security;
alter table user_collected_markers enable row level security;

drop policy if exists markers_read_all on markers;
drop policy if exists markers_write_editor on markers;
drop policy if exists markers_update_editor on markers;
drop policy if exists markers_delete_admin on markers;
drop policy if exists collected_select_own on user_collected_markers;
drop policy if exists collected_insert_own on user_collected_markers;
drop policy if exists collected_delete_own on user_collected_markers;

create policy markers_read_all
on markers
for select
using (true);

create policy markers_write_editor
on markers
for insert
with check (current_setting('app.role', true) in ('editor','moderator','admin'));

create policy markers_update_editor
on markers
for update
using (current_setting('app.role', true) in ('editor','moderator','admin'))
with check (current_setting('app.role', true) in ('editor','moderator','admin'));

create policy markers_delete_admin
on markers
for delete
using (current_setting('app.role', true) in ('moderator','admin'));

create policy collected_select_own
on user_collected_markers
for select
using (user_id::text = current_setting('app.user_id', true));

create policy collected_insert_own
on user_collected_markers
for insert
with check (user_id::text = current_setting('app.user_id', true));

create policy collected_delete_own
on user_collected_markers
for delete
using (user_id::text = current_setting('app.user_id', true));
