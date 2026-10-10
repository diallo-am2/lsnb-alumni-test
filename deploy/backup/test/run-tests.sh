#!/usr/bin/env bash
# End-to-end test of lsnb-backup with REAL age keys, a real rclone (a local folder plays the
# bucket) and a real PostgreSQL. Needs: postgresql, age, rclone, attr (optional, for xattrs).
# Run: deploy/backup/test/run-tests.sh   (as root it re-runs itself as the "postgres" user)
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
if [ "$(id -u)" = 0 ]; then
  copy="$(mktemp -d)"
  cp -r "$ROOT" "$copy/backup"
  chmod -R a+rX "$copy"
  exec runuser -u postgres -- bash "$copy/backup/test/run-tests.sh" "$@"
fi

# shellcheck disable=SC2012
PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -n 1)"
[ -x "$PG_BIN/initdb" ] || { echo "PostgreSQL introuvable"; exit 2; }
for t in age age-keygen rclone; do command -v "$t" >/dev/null || { echo "$t introuvable"; exit 2; }; done
export PATH="$PG_BIN:$PATH"

T="$(mktemp -d)"
PORT=54341
FAILURES=0
PASSES=0
cleanup() { pg_ctl -D "$T/pg" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$T"; }
trap cleanup EXIT

pass() { PASSES=$((PASSES + 1)); printf '  ok   %s\n' "$*"; }
fail() { FAILURES=$((FAILURES + 1)); printf '  FAIL %s\n' "$*"; }
expect() { if [ "$1" = "$2" ]; then pass "$3"; else fail "$3 (attendu « $1 », obtenu « $2 »)"; fi; }
sql() { psql -X -At -v ON_ERROR_STOP=1 -h "$T" -p $PORT -U postgres -d postgres "$@"; }

echo "Préparation : PostgreSQL, clés age, bucket local"
initdb -D "$T/pg" --auth=trust -U postgres --no-sync >/dev/null
pg_ctl -D "$T/pg" -o "-p $PORT -k $T -c listen_addresses='' -c fsync=off" -w -l "$T/pg.log" start >/dev/null
sql -q <<'SQL'
create schema auth; create schema storage;
create table auth.users (id uuid primary key default gen_random_uuid(), email text not null);
create table auth.schema_migrations (version text primary key);
create table storage.migrations (id int primary key);
create table public.profiles (id uuid primary key, first_name text);
insert into auth.users (email) select 'member' || n || '@example.test' from generate_series(1, 5) n;
insert into auth.schema_migrations values ('only-here');
insert into public.profiles select id, 'Prénom' from auth.users;
SQL

mkdir -p "$T/keys" "$T/home" "$T/bucket"
age-keygen -o "$T/keys/key.txt" 2>/dev/null
age-keygen -o "$T/keys/other.txt" 2>/dev/null
RECIPIENT="$(age-keygen -y "$T/keys/key.txt")"

SECRET="SUPER_SECRET_JWT_VALUE_12345"
mkdir -p "$T/storage/stub/stub/avatars" "$T/stack/volumes/api" "$T/stack/volumes/db/data" "$T/stack/volumes/storage" "$T/stack/volumes/logs" "$T/etc/nginx"
echo "png-bytes" >"$T/storage/stub/stub/avatars/a.png"
HAVE_XATTR=0
if command -v setfattr >/dev/null && setfattr -n user.supabase.content-type -v image/png "$T/storage/stub/stub/avatars/a.png" 2>/dev/null; then HAVE_XATTR=1; fi
echo "JWT_SECRET=$SECRET" >"$T/stack/.env"
echo "services: {}" >"$T/stack/docker-compose.yml"
echo "envoy" >"$T/stack/volumes/api/envoy.yaml"
echo "live-database-file" >"$T/stack/volumes/db/data/PG_VERSION"
echo "live-storage-file" >"$T/stack/volumes/storage/x"
echo "log" >"$T/stack/volumes/logs/l"
echo "server { }" >"$T/etc/nginx/site.conf"

printf '[bk]\ntype = local\n' >"$T/rclone.conf"
cat >"$T/backup.env" <<EOF
AGE_RECIPIENT="$RECIPIENT"
REMOTE="bk:$T/bucket"
PREFIX="lsnb"
DB_PGDUMP="pg_dump -h $T -p $PORT -U postgres -d postgres"
STORAGE_DIR="$T/storage"
CONFIG_DIR="$T/stack"
EXTRA_PATHS="$T/etc/nginx"
WORK_DIR="$T/work"
EOF
export HOME="$T/home" RCLONE_CONFIG="$T/rclone.conf" LSNB_BACKUP_CONF="$T/backup.env"
BK="$ROOT/lsnb-backup"
B="$T/bucket/lsnb"
count_of() { find "$B" -name "$1" 2>/dev/null | wc -l; }
bk() { "$BK" "$@" >"$T/out.log" 2>&1; }
# The config file wins over the environment, so a scenario gets its own config: bko 'KEY=value' <command…>
bko() { local over="$1"; shift; { cat "$T/backup.env"; printf '%s\n' "$over"; } >"$T/over.env"; LSNB_BACKUP_CONF="$T/over.env" "$BK" "$@" >"$T/out.log" 2>&1; }
ok_if() { local label="$1"; shift; if "$@"; then pass "$label"; else fail "$label"; fi; }

echo; echo "1. Diagnostic"
if bk doctor; then pass "doctor : tout est prêt"; else fail "doctor a échoué"; cat "$T/out.log"; fi
if grep -q "écriture, relecture et suppression" "$T/out.log"; then pass "écriture dans le bucket vérifiée"; else fail "écriture non vérifiée"; fi
expect "0" "$(find "$B" -name 'doctor-test*' 2>/dev/null | wc -l)" "l'objet de test a été supprimé"

echo "2. Première sauvegarde"
if bk run; then pass "run termine sans erreur"; else fail "run a échoué"; cat "$T/out.log"; fi
for kind in db storage config extra; do expect "1" "$(count_of "$kind-*.age")" "une archive « $kind » chiffrée"; done
expect "4" "$(count_of '*.sha256')" "une somme de contrôle par archive"
if grep -rlq "PostgreSQL database dump\|$SECRET\|member1@example.test\|png-bytes" "$B"; then fail "du contenu en clair est présent dans le bucket"; else pass "rien n'est lisible sans la clé (ni dump, ni secrets, ni fichiers)"; fi
all_age=1
for f in "$B"/*.age; do [ "$(head -c 21 "$f")" = "age-encryption.org/v1" ] || all_age=0; done
expect "1" "$all_age" "toutes les archives ont l'en-tête age"
if bk status; then pass "status : à jour"; else fail "status devrait être à jour"; fi

echo "3. Restauration à blanc avec la clé privée"
DB_FILE="$(basename "$(find "$B" -name 'db-*.age')")"
if bk restore-test "$DB_FILE" --identity "$T/keys/key.txt"; then pass "restore-test (base) réussit"; else fail "restore-test (base) a échoué"; cat "$T/out.log"; fi
if grep -q "tables" "$T/out.log"; then pass "le dump déchiffré est complet"; else fail "dump incomplet"; fi
age -d -i "$T/keys/key.txt" "$B/$DB_FILE" | gzip -dc >"$T/dump.sql"
if grep -q "member3@example.test" "$T/dump.sql" && ! grep -q "only-here" "$T/dump.sql"; then pass "données présentes, tables de migration exclues"; else fail "contenu du dump inattendu"; fi
if bk restore-test "$DB_FILE" --identity "$T/keys/other.txt"; then fail "une mauvaise clé a déchiffré"; else pass "une autre clé est refusée"; fi
CONFIG_FILE="$(find "$B" -name 'config-*.age')"
mkdir -p "$T/restored"
age -d -i "$T/keys/key.txt" "$CONFIG_FILE" | tar -xzf - -C "$T/restored"
expect "JWT_SECRET=$SECRET" "$(cat "$T/restored/.env")" "la configuration (.env) se restaure"
if [ -e "$T/restored/volumes/db/data" ] || [ -e "$T/restored/volumes/storage/x" ] || [ -e "$T/restored/volumes/logs/l" ]; then fail "la base vivante, le stockage ou les journaux ont été sauvegardés avec la configuration"; else pass "base vivante, stockage et journaux exclus de la configuration"; fi
mkdir -p "$T/restored-files"
age -d -i "$T/keys/key.txt" "$(find "$B" -name 'storage-*.age')" | tar --xattrs --xattrs-include='user.*' -xzf - -C "$T/restored-files"
expect "png-bytes" "$(cat "$T/restored-files/stub/stub/avatars/a.png")" "les fichiers se restaurent"
if [ "$HAVE_XATTR" = 1 ]; then expect "image/png" "$(getfattr --only-values -n user.supabase.content-type "$T/restored-files/stub/stub/avatars/a.png" 2>/dev/null)" "attributs étendus conservés"; fi
if bk restore-test "$(basename "$(find "$B" -name 'storage-*.age')")" --identity "$T/keys/key.txt"; then pass "restore-test (fichiers) réussit"; else fail "restore-test (fichiers) a échoué"; fi

echo "4. Vérification à distance"
if bk verify; then pass "verify : sauvegardes à jour et intactes"; else fail "verify a échoué"; cat "$T/out.log"; fi

echo "5. Deuxième sauvegarde : seul ce qui a changé repart"
sleep 1
if bk run; then pass "run réussit"; else fail "run a échoué"; cat "$T/out.log"; fi
expect "2" "$(count_of 'db-*.age')" "nouvelle copie de la base (toujours envoyée)"
for kind in storage config extra; do expect "1" "$(count_of "$kind-*.age")" "$kind inchangé : rien de renvoyé"; done
echo "nouveau fichier" >"$T/storage/stub/stub/avatars/b.png"
sleep 1
bk run || { fail "run a échoué"; cat "$T/out.log"; }
expect "2" "$(count_of 'storage-*.age')" "un fichier ajouté : nouvelle archive des fichiers"
expect "1" "$(count_of 'config-*.age')" "la configuration n'est pas renvoyée pour autant"

echo "6. Échecs : rien de faux n'est enregistré"
before="$(count_of '*.age')"
if bko 'DB_PGDUMP="false"' run; then fail "run aurait dû échouer"; else pass "dump impossible : run échoue"; fi
ok_if "message explicite" grep -q "dump de la base" "$T/out.log"
expect "$before" "$(count_of '*.age')" "aucune archive à moitié envoyée"
if bk status; then fail "status devrait signaler l'échec"; else pass "status signale l'échec"; fi
if bko 'AGE_RECIPIENT="age1invalide"' run; then fail "clé invalide acceptée"; else pass "clé publique invalide refusée"; fi
expect "$before" "$(count_of '*.age')" "toujours aucune archive en clair ou partielle"
ok_if "la sauvegarde suivante réussit" bk run
if bk status; then pass "status de nouveau à jour"; else fail "status devrait être à jour"; fi

echo "7. verify détecte les problèmes"
mkdir -p "$T/bucket/tamper" "$T/bucket/nosum" "$T/bucket/old"
cp "$B"/* "$T/bucket/tamper/"
latest_db="$(basename "$(find "$T/bucket/tamper" -name 'db-*.age' | sort | tail -n 1)")"
head -c 100 "$T/bucket/tamper/$latest_db" >"$T/cut" && cp "$T/cut" "$T/bucket/tamper/$latest_db"
if bko 'PREFIX=tamper' verify; then fail "archive tronquée non détectée"; else pass "archive tronquée détectée"; fi
ok_if "message « corrompu »" grep -q "corrompu" "$T/out.log"
cp "$B"/* "$T/bucket/nosum/"
latest_st="$(find "$T/bucket/nosum" -name 'storage-*.age' | sort | tail -n 1)"
rm "$latest_st.sha256"
if bko 'PREFIX=nosum' verify; then fail "somme de contrôle absente non détectée"; else pass "envoi incomplet détecté (somme de contrôle absente)"; fi
old_db="db-$(date -u -d '3 days ago' +%Y%m%dT030000Z).sql.gz.age"
cp "$B/$DB_FILE" "$T/bucket/old/$old_db"; cp "$B/$DB_FILE.sha256" "$T/bucket/old/$old_db.sha256"
if bko $'PREFIX=old\nVERIFY_KINDS=db' verify; then fail "sauvegarde trop ancienne non détectée"; else pass "sauvegarde trop ancienne détectée"; fi
ok_if "l'âge et la limite sont affichés" grep -q "limite" "$T/out.log"
if bko 'PREFIX=absent' verify; then fail "dossier absent non détecté"; else pass "aucune sauvegarde : détecté"; fi

echo "8. Nettoyage de l'historique"
mkdir -p "$T/bucket/ret"
mk() { # mk <name> <days old>
  echo x >"$T/bucket/ret/$1"; echo x >"$T/bucket/ret/$1.sha256"
  touch -d "$2 days ago" "$T/bucket/ret/$1" "$T/bucket/ret/$1.sha256"
}
mk "db-20240101T030000Z.sql.gz.age" 600     # older than the monthly limit: removed
mk "db-20250101T030000Z.sql.gz.age" 500     # monthly but older than 400 days: removed
mk "db-20260801T030000Z.sql.gz.age" 70      # monthly (the 1st), within 400 days: kept
mk "db-20260815T030000Z.sql.gz.age" 55      # ordinary, older than 30 days: removed
mk "db-20261003T030000Z.sql.gz.age" 6       # recent: kept
if bko 'PREFIX=ret' run; then pass "run avec nettoyage réussit"; else fail "run a échoué"; cat "$T/out.log"; fi
for kept in db-20260801T030000Z db-20261003T030000Z; do ok_if "conservé : $kept" test -e "$T/bucket/ret/$kept.sql.gz.age"; done
for gone in db-20240101T030000Z db-20250101T030000Z db-20260815T030000Z; do ok_if "supprimé : $gone" test ! -e "$T/bucket/ret/$gone.sql.gz.age"; done
ok_if "la somme de contrôle part avec son archive" test ! -e "$T/bucket/ret/db-20260815T030000Z.sql.gz.age.sha256"

echo "9. Diagnostic : cas d'erreur"
cp "$T/keys/key.txt" "$T/home/oops.txt"
if bk doctor; then pass "doctor réussit malgré l'avertissement"; else fail "doctor ne devrait pas échouer pour un avertissement"; fi
if grep -q "clé PRIVÉE" "$T/out.log"; then pass "clé privée sur le serveur signalée"; else fail "clé privée non signalée"; fi
rm -f "$T/home/oops.txt"
if bko "REMOTE=\"bk:$T/nulle-part/bucket\"" doctor; then fail "bucket injoignable non détecté"; else pass "bucket injoignable détecté"; fi
if bko 'AGE_RECIPIENT=""' doctor; then fail "clé absente non détectée"; else pass "clé publique absente détectée"; fi
chmod 000 "$T/storage/stub"
if bk doctor; then fail "dossier illisible non détecté"; else pass "dossier illisible détecté"; fi
chmod 755 "$T/storage/stub"
if bk doctor --read-only; then pass "doctor --read-only n'exige que la lecture"; else fail "doctor --read-only a échoué"; cat "$T/out.log"; fi

echo "10. Récupération"
if bk fetch "$DB_FILE" "$T/dl.age"; then pass "fetch réussit"; else fail "fetch a échoué"; fi
if cmp -s "$T/dl.age" "$B/$DB_FILE"; then pass "fichier identique à celui du bucket"; else fail "fichier différent"; fi
if bk list && grep -q "$DB_FILE" "$T/out.log"; then pass "list affiche les sauvegardes"; else fail "list incomplet"; fi

echo
if [ "$FAILURES" -eq 0 ]; then echo "Tout passe : $PASSES vérifications."; else echo "$FAILURES échec(s) sur $((PASSES + FAILURES)) vérifications."; fi
[ "$FAILURES" -eq 0 ]
