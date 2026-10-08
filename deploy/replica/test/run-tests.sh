#!/usr/bin/env bash
# End-to-end test of lsnb-sync / lsnb-export against two REAL PostgreSQL servers and a real
# rsync + rrsync. Only ssh is faked (it runs the forced command locally).
#
# Needs: postgresql (initdb, pg_ctl, psql, pg_dump), rsync (with rrsync).
# Run:   deploy/replica/test/run-tests.sh      (as root: sudo -u postgres is used automatically)
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

if [ "$(id -u)" = 0 ]; then
  copy="$(mktemp -d)"
  cp -r "$ROOT" "$copy/replica"
  chmod -R a+rX "$copy"
  exec runuser -u postgres -- bash "$copy/replica/test/run-tests.sh" "$@"
fi

# shellcheck disable=SC2012
PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -n 1)"
[ -x "$PG_BIN/initdb" ] || { echo "PostgreSQL introuvable (paquet postgresql)"; exit 2; }
command -v rrsync >/dev/null || { echo "rrsync introuvable (paquet rsync)"; exit 2; }
export PATH="$PG_BIN:$PATH"

T="$(mktemp -d)"
SRC_PORT=54331
DST_PORT=54332
FAILURES=0
PASSES=0

cleanup() {
  pg_ctl -D "$T/src" -m immediate stop >/dev/null 2>&1 || true
  pg_ctl -D "$T/dst" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$T"
}
trap cleanup EXIT

pass() { PASSES=$((PASSES + 1)); printf '  ok   %s\n' "$*"; }
fail() { FAILURES=$((FAILURES + 1)); printf '  FAIL %s\n' "$*"; }
expect() { # expect <expected> <actual> <label>
  if [ "$1" = "$2" ]; then pass "$3"; else fail "$3 (attendu « $1 », obtenu « $2 »)"; fi
}

src() { psql -X -At -v ON_ERROR_STOP=1 -h "$T" -p $SRC_PORT -U postgres -d postgres "$@"; }
dst() { psql -X -At -v ON_ERROR_STOP=1 -h "$T" -p $DST_PORT -U postgres -d postgres "$@"; }

echo "Préparation : deux serveurs PostgreSQL ($("$PG_BIN/postgres" --version))"
for side in src dst; do
  port=$SRC_PORT; [ "$side" = dst ] && port=$DST_PORT
  initdb -D "$T/$side" --auth=trust -U postgres --no-sync >/dev/null
  pg_ctl -D "$T/$side" -o "-p $port -k $T -c listen_addresses='' -c fsync=off" -w -l "$T/$side.log" start >/dev/null
done

cat >"$T/ddl.sql" <<'SQL'
create schema auth;
create schema storage;
create table auth.users (
  id uuid primary key default gen_random_uuid(), email text not null unique, encrypted_password text,
  email_confirmed_at timestamptz, confirmed_at timestamptz generated always as (email_confirmed_at) stored);
create table auth.identities (id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade, provider text not null);
create table auth.refresh_tokens (id bigserial primary key, user_id uuid references auth.users(id) on delete cascade, token text);
create table auth.schema_migrations (version text primary key);
create table storage.buckets (id text primary key, public boolean default false);
create table storage.objects (id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id), name text not null, metadata jsonb);
create table storage.migrations (id int primary key, name text);
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null);
create table public.audit (id bigserial primary key, note text);
create function public.handle_new_member() returns trigger language plpgsql as $$
begin
  insert into public.profiles(id, first_name) values (new.id, 'auto');
  insert into public.audit(note) values ('trigger fired');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_member();
alter table public.profiles enable row level security;
create policy "members read" on public.profiles for select using (true);
SQL
src -q -f "$T/ddl.sql"
dst -q -f "$T/ddl.sql"

seed_source() {
  src -q -o /dev/null <<'SQL'
set session_replication_role = replica;   -- load rows as they are, without our trigger
insert into auth.users (email, encrypted_password, email_confirmed_at)
  select 'member' || n || '@example.test', 'hash' || n, now() from generate_series(1, 12) n;
insert into auth.identities (user_id, provider) select id, 'google' from auth.users;
insert into auth.refresh_tokens (user_id, token) select id, 'tok-' || id from auth.users;
insert into public.profiles (id, first_name) select id, 'Prénom ' || email from auth.users;
insert into storage.buckets values ('avatars', true), ('opportunity-media', false);
insert into storage.objects (bucket_id, name) values ('avatars', 'a.png'), ('opportunity-media', 'doc.pdf');
insert into auth.schema_migrations values ('src-only');
select setval('auth.refresh_tokens_id_seq', 500);
SQL
}
seed_source

# The replica starts with stale rows that must disappear, and its own migration bookkeeping.
dst -q <<'SQL'
set session_replication_role = replica;
insert into auth.users (email) values ('stale1@example.test'), ('stale2@example.test');
insert into public.profiles select id, 'Obsolète' from auth.users;
insert into auth.schema_migrations values ('target-only');
SQL

# Files: the primary has some, the replica has a stale one that must be removed.
mkdir -p "$T/src-storage/stub/avatars" "$T/dst-storage/stub/avatars"
echo "png-1" >"$T/src-storage/stub/avatars/a.png"
echo "pdf-1" >"$T/src-storage/stub/doc.pdf"
echo "old" >"$T/dst-storage/stub/avatars/old.png"
HAVE_XATTR=0
if command -v setfattr >/dev/null && command -v getfattr >/dev/null \
  && setfattr -n user.supabase.content-type -v image/png "$T/src-storage/stub/avatars/a.png" 2>/dev/null; then
  HAVE_XATTR=1
fi

# --- wiring: forced command on the "primary", fake ssh that runs it locally -------------------
cp "$ROOT/fingerprint.sql" "$T/fingerprint.sql"
cat >"$T/export.conf" <<EOF
DB_PSQL="psql -X -h $T -p $SRC_PORT -U postgres -d postgres"
DB_PGDUMP="pg_dump -h $T -p $SRC_PORT -U postgres -d postgres"
STORAGE_DIR="$T/src-storage"
FINGERPRINT_SQL="$T/fingerprint.sql"
EOF
mkdir -p "$T/bin"
cat >"$T/bin/ssh" <<EOF
#!/usr/bin/env bash
while [ \$# -gt 0 ]; do
  case "\$1" in
    -i|-p|-o|-l) shift 2 ;;
    -*) shift ;;
    *) shift; break ;;
  esac
done
export SSH_ORIGINAL_COMMAND="\$*"
export LSNB_EXPORT_CONF="$T/export.conf"
case "\${LSNB_TEST_MODE:-}:\$SSH_ORIGINAL_COMMAND" in
  truncate:db-data)
    "$ROOT/primary/lsnb-export" | head -c 150 ;;
  badsql:db-data)
    { "$ROOT/primary/lsnb-export" | gzip -dc | sed '\$d' | sed '\$d'
      echo "INSERT INTO public.does_not_exist VALUES (1);"
      echo "-- PostgreSQL database dump complete"
    } | gzip -c ;;
  *)
    exec "$ROOT/primary/lsnb-export" ;;
esac
EOF
chmod +x "$T/bin/ssh"
touch "$T/key"
cat >"$T/sync.env" <<EOF
PRIMARY_HOST="fake-primary"
SSH_KEY="$T/key"
LOCAL_PSQL="psql -X -h $T -p $DST_PORT -U postgres -d postgres"
STORAGE_DEST="$T/dst-storage"
WORK_DIR="$T/work"
FINGERPRINT_SQL="$T/fingerprint.sql"
EOF
export PATH="$T/bin:$PATH"
export LSNB_SYNC_CONF="$T/sync.env"
SYNC="$ROOT/replica/lsnb-sync"

users_sum() { "$1" -c "select md5(coalesce(string_agg(id::text || email || coalesce(encrypted_password,'') || coalesce(confirmed_at::text,''), ',' order by id), '')) from auth.users"; }
profiles_sum() { "$1" -c "select md5(coalesce(string_agg(id::text || first_name, ',' order by id), '')) from public.profiles"; }
count() { "$1" -c "select count(*) from $2"; }
run_sync() { "$SYNC" run "$@" >"$T/last.log" 2>&1; }

echo
echo "1. Diagnostic"
if "$SYNC" doctor >"$T/doctor.log" 2>&1; then pass "doctor : tout est prêt"; else fail "doctor a échoué"; cat "$T/doctor.log"; fi

echo "2. Première synchro"
if run_sync; then pass "run termine sans erreur"; else fail "run a échoué"; cat "$T/last.log"; fi
expect "12" "$(count dst auth.users)" "12 membres sur la réplique (les 2 obsolètes ont disparu)"
expect "$(users_sum src)" "$(users_sum dst)" "membres identiques ligne à ligne (mots de passe, colonne générée)"
expect "$(profiles_sum src)" "$(profiles_sum dst)" "profils identiques"
expect "0" "$(dst -c "select count(*) from public.profiles where first_name = 'auto'")" "le trigger de création de profil n'a pas rejoué"
expect "0" "$(count dst public.audit)" "aucun effet de bord des triggers"
expect "12" "$(count dst auth.identities)" "identités Google copiées"
expect "12" "$(count dst auth.refresh_tokens)" "sessions copiées (les membres restent connectés)"
expect "500" "$(dst -c "select last_value from auth.refresh_tokens_id_seq")" "compteurs (séquences) alignés"
expect "2" "$(count dst storage.objects)" "métadonnées du stockage copiées"
expect "target-only" "$(dst -c "select string_agg(version, ',') from auth.schema_migrations")" "les migrations propres à la réplique sont intactes"
if diff -r "$T/src-storage" "$T/dst-storage" >/dev/null; then pass "fichiers identiques (le fichier obsolète a été supprimé)"; else fail "fichiers différents"; diff -r "$T/src-storage" "$T/dst-storage" || true; fi
if [ "$HAVE_XATTR" = 1 ]; then
  expect "image/png" "$(getfattr --only-values -n user.supabase.content-type "$T/dst-storage/stub/avatars/a.png" 2>/dev/null)" "attributs étendus conservés"
else
  echo "  --   attributs étendus : outil setfattr absent, test ignoré"
fi
if "$SYNC" status >/dev/null; then pass "status : à jour"; else fail "status devrait être à jour"; fi
expect "1" "$(find "$T/work/dumps" -name 'db-*.sql.gz' | wc -l)" "une copie horodatée conservée"
FIRST_SUM="$(users_sum dst)"
FIRST_DUMP="$(find "$T/work/dumps" -name 'db-*.sql.gz' | sort | head -n 1)"

echo "3. Seconde synchro (rien n'a changé)"
before_users="$(users_sum dst)"
if run_sync; then pass "run idempotent"; else fail "second run a échoué"; cat "$T/last.log"; fi
expect "$before_users" "$(users_sum dst)" "données inchangées"

echo "4. Les changements du primaire se propagent, suppressions comprises"
src -q <<'SQL'
set session_replication_role = replica;
insert into auth.users (email) values ('nouveau@example.test');
delete from auth.users where email = 'member1@example.test';
SQL
echo "png-2" >"$T/src-storage/stub/avatars/b.png"
rm "$T/src-storage/stub/doc.pdf"
if ! run_sync; then fail "run a échoué"; cat "$T/last.log"; fi
expect "12" "$(count dst auth.users)" "12 membres (1 ajouté, 1 supprimé)"
expect "$(users_sum src)" "$(users_sum dst)" "membres toujours identiques"
if diff -r "$T/src-storage" "$T/dst-storage" >/dev/null; then pass "fichiers identiques (ajout et suppression)"; else fail "fichiers différents"; fi

echo "5. Structure différente : refus net, rien n'est touché"
dst -q -c "alter table public.profiles add column bio text"
before="$(users_sum dst)"
if run_sync; then fail "run aurait dû refuser"; else pass "run refuse"; fi
if grep -q "même structure" "$T/last.log"; then pass "message explicite"; else fail "message absent"; fi
if grep -q "public.profiles.bio" "$T/last.log"; then pass "la colonne en cause est montrée"; else fail "colonne non montrée"; fi
expect "$before" "$(users_sum dst)" "la réplique n'a pas bougé"
if "$SYNC" status >/dev/null 2>&1; then fail "status devrait signaler l'échec"; else pass "status signale l'échec"; fi
dst -q -c "alter table public.profiles drop column bio"
if run_sync; then pass "la synchro repart une fois la structure corrigée"; else fail "run devrait repartir"; cat "$T/last.log"; fi

echo "6. Transfert tronqué ou restauration cassée : la réplique garde son état"
before="$(users_sum dst)"
src -q -c "set session_replication_role = replica; insert into auth.users (email) values ('apres-coupure@example.test')"
if LSNB_TEST_MODE=truncate run_sync; then fail "copie tronquée acceptée"; else pass "copie tronquée refusée"; fi
expect "$before" "$(users_sum dst)" "réplique intacte après copie tronquée"
if LSNB_TEST_MODE=badsql run_sync; then fail "restauration cassée acceptée"; else pass "restauration cassée refusée"; fi
if grep -q "restauration échouée" "$T/last.log"; then pass "message explicite"; else fail "message absent"; fi
expect "$before" "$(users_sum dst)" "retour en arrière complet (une seule transaction)"
if run_sync; then pass "la synchro suivante réussit"; else fail "la synchro suivante a échoué"; fi
expect "$(users_sum src)" "$(users_sum dst)" "réplique de nouveau identique"

echo "7. Garde-fou : un primaire vidé n'écrase pas la réplique"
src -q -c "set session_replication_role = replica; delete from auth.users"
before="$(users_sum dst)"
if run_sync; then fail "run aurait dû refuser"; else pass "run refuse"; fi
if grep -q "plus de la moitié" "$T/last.log"; then pass "message explicite"; else fail "message absent"; fi
expect "$before" "$(users_sum dst)" "la réplique garde ses membres"
if run_sync --force; then pass "--force passe outre quand on le décide"; else fail "--force aurait dû passer"; cat "$T/last.log"; fi
expect "0" "$(count dst auth.users)" "réplique alignée avec --force"

echo "8. Retour dans le temps : restaurer une ancienne copie"
if "$SYNC" restore "$(basename "$FIRST_DUMP")" --yes >"$T/restore.log" 2>&1; then pass "restore termine sans erreur"; else fail "restore a échoué"; cat "$T/restore.log"; fi
expect "12" "$(count dst auth.users)" "les 12 membres de la première copie sont revenus"
expect "$FIRST_SUM" "$(users_sum dst)" "identiques à la première synchro"
if "$SYNC" restore inexistante.sql.gz --yes >/dev/null 2>&1; then fail "copie inconnue acceptée"; else pass "copie inconnue refusée"; fi

echo "9. L'accès du primaire est restreint"
export LSNB_EXPORT_CONF="$T/export.conf"
for forbidden in "rm -rf /" "cat /etc/passwd" "rsync --server -vlogDtpre.iLsfxCIvu . /" "db-data; id"; do
  rc=0
  SSH_ORIGINAL_COMMAND="$forbidden" "$ROOT/primary/lsnb-export" >"$T/deny.out" 2>&1 || rc=$?
  expect "126" "$rc" "refusé : $forbidden"
done
rc=0
SSH_ORIGINAL_COMMAND="rsync --server --sender -logDtpre.iLsfxCIvu . ../../../etc/" "$ROOT/primary/lsnb-export" >"$T/deny.out" 2>&1 || rc=$?
if [ "$rc" != 0 ] && ! grep -q 'root:' "$T/deny.out"; then pass "rrsync refuse de sortir du dossier de stockage"; else fail "sortie du dossier possible"; fi

echo
if [ "$FAILURES" -eq 0 ]; then echo "Tout passe : $PASSES vérifications."; else echo "$FAILURES échec(s) sur $((PASSES + FAILURES)) vérifications."; fi
[ "$FAILURES" -eq 0 ]
